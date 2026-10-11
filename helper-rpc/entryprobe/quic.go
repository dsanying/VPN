package entryprobe

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"net"
	"time"
)

// RFC 9000 sections 6/15/17.2.1: a reserved version elicits a Version
// Negotiation response. This measures only the entry round trip, never proxy
// authentication, TLS identity or the ability to relay an external request.
func quicRequest() ([]byte, error) {
	packet := make([]byte, 1200)
	if _, err := rand.Read(packet); err != nil {
		return nil, err
	}
	packet[0] = 0xc0
	binary.BigEndian.PutUint32(packet[1:5], 0x0a0a0a0a)
	packet[5], packet[14] = 8, 8
	return packet, nil
}
func validQUICResponse(packet, request []byte) bool {
	if len(packet) < 7 || packet[0]&0x80 == 0 || binary.BigEndian.Uint32(packet[1:5]) != 0 {
		return false
	}
	offset := 6
	dcidLen := int(packet[5])
	if dcidLen != 8 || offset+dcidLen >= len(packet) || !bytes.Equal(packet[offset:offset+dcidLen], request[15:23]) {
		return false
	}
	offset += dcidLen
	scidLen := int(packet[offset])
	offset++
	if scidLen != 8 || offset+scidLen >= len(packet) || !bytes.Equal(packet[offset:offset+scidLen], request[6:14]) {
		return false
	}
	offset += scidLen
	if (len(packet)-offset)%4 != 0 {
		return false
	}
	supported := false
	for offset < len(packet) {
		version := binary.BigEndian.Uint32(packet[offset : offset+4])
		offset += 4
		if version == 0x0a0a0a0a {
			return false
		}
		if version != 0 && version&0x0f0f0f0f != 0x0a0a0a0a {
			supported = true
		}
	}
	return supported
}
func probeQUIC(ctx context.Context, conn net.Conn) Result {
	return probeQUICObfs(ctx, conn, nil)
}
func probeQUICObfs(ctx context.Context, conn net.Conn, obfs *Obfs) Result {
	packet, err := quicRequest()
	if err != nil {
		return Result{Status: "unavailable", Reason: "ENTRY_RANDOM_FAILED"}
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(4 * time.Second)
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return Result{Status: "failed", Reason: "ENTRY_CONNECT_FAILED"}
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	packets, err := obfuscate(packet, obfs)
	if err != nil {
		return Result{Status: "unavailable", Reason: "ENTRY_OBFS_INVALID"}
	}
	decoder := deobfuscator{obfs: obfs}
	start := time.Now()
	for _, outgoing := range packets {
		if _, err = conn.Write(outgoing); err != nil {
			return Result{Status: "failed", Reason: "ENTRY_SEND_FAILED"}
		}
	}
	// Bounded retransmissions tolerate UDP packet loss. The reported elapsed
	// time includes retransmissions, just like a TCP connection attempt.
	retryCtx, cancelRetries := context.WithCancel(ctx)
	defer cancelRetries()
	retryDone := make(chan struct{})
	go func() {
		defer close(retryDone)
		for _, delay := range []time.Duration{500 * time.Millisecond, time.Second, time.Second} {
			timer := time.NewTimer(delay)
			select {
			case <-retryCtx.Done():
				timer.Stop()
				return
			case <-timer.C:
				for _, outgoing := range packets {
					if _, err := conn.Write(outgoing); err != nil {
						return
					}
				}
			}
		}
	}()
	defer func() { cancelRetries(); <-retryDone }()
	buffer := make([]byte, 4096)
	for received := 0; received < 64; received++ {
		count, err := conn.Read(buffer)
		if err != nil {
			if ctx.Err() != nil || time.Now().After(deadline) {
				return Result{Status: "timeout"}
			}
			return Result{Status: "failed", Reason: "ENTRY_CONNECT_FAILED"}
		}
		if validQUICResponse(decoder.decode(buffer[:count]), packet) {
			elapsed := time.Since(start).Milliseconds()
			return Result{Status: "ok", LatencyMs: &elapsed}
		}
	}
	return Result{Status: "failed", Reason: "ENTRY_INVALID_RESPONSE"}
}
