package entryprobe

import (
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func negotiation(request []byte) []byte {
	reply := make([]byte, 27)
	reply[0], reply[5], reply[14] = 0x80, 8, 8
	copy(reply[6:14], request[15:23])
	copy(reply[15:23], request[6:14])
	binary.BigEndian.PutUint32(reply[23:], 1)
	return reply
}
func TestNegotiationValidation(t *testing.T) {
	request, err := quicRequest()
	if err != nil {
		t.Fatal(err)
	}
	if len(request) != 1200 {
		t.Fatal("QUIC Initial size")
	}
	good := negotiation(request)
	if !validQUICResponse(good, request) {
		t.Fatal("valid negotiation rejected")
	}
	for _, change := range []func([]byte) []byte{
		func(p []byte) []byte { p[0] = 0; return p },
		func(p []byte) []byte { p[4] = 1; return p },
		func(p []byte) []byte { p[6] ^= 1; return p },
		func(p []byte) []byte { p[15] ^= 1; return p },
		func(p []byte) []byte { p[5] = 255; return p },
		func(p []byte) []byte { p[14] = 255; return p },
		func(p []byte) []byte { binary.BigEndian.PutUint32(p[23:], 0x0a0a0a0a); return p },
		func(p []byte) []byte { binary.BigEndian.PutUint32(p[23:], 0); return p },
		func(p []byte) []byte { return p[:23] },
		func(p []byte) []byte { return append(p, 0) },
	} {
		if validQUICResponse(change(append([]byte(nil), good...)), request) {
			t.Fatal("invalid negotiation accepted")
		}
	}
	for length := 0; length < len(good); length++ {
		if validQUICResponse(good[:length], request) {
			t.Fatal("truncated response accepted")
		}
	}
}
func TestQUICRealDatagramAndInvalidResponse(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "::1"} {
		t.Run(address, func(t *testing.T) {
			listener, err := net.ListenPacket("udp", net.JoinHostPort(address, "0"))
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			go func() {
				buffer := make([]byte, 1500)
				n, peer, err := listener.ReadFrom(buffer)
				if err != nil {
					return
				}
				_, _ = listener.WriteTo([]byte("invalid packet"), peer)
				_, _ = listener.WriteTo(negotiation(buffer[:n]), peer)
			}()
			conn, err := net.Dial("udp", listener.LocalAddr().String())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			result := probeQUIC(ctx, conn)
			if result.Status != "ok" || result.LatencyMs == nil {
				t.Fatalf("%+v", result)
			}
		})
	}
}
func TestUDPSendAloneIsNotLatency(t *testing.T) {
	listener, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	conn, err := net.Dial("udp", listener.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	result := probeQUIC(ctx, conn)
	if result.Status != "timeout" || result.LatencyMs != nil {
		t.Fatalf("%+v", result)
	}
}
func TestQUICCancellationClosesSocket(t *testing.T) {
	listener, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	conn, err := net.Dial("udp", listener.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	time.AfterFunc(10*time.Millisecond, cancel)
	start := time.Now()
	result := probeQUIC(ctx, conn)
	if result.LatencyMs != nil || time.Since(start) > 500*time.Millisecond {
		t.Fatalf("%+v", result)
	}
}
func FuzzNegotiation(f *testing.F) {
	request, _ := quicRequest()
	f.Add(negotiation(request))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, packet []byte) { _ = validQUICResponse(packet, request) })
}

func TestQUICRetriesPacketLoss(t *testing.T) {
	listener, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		buffer := make([]byte, 1500)
		_, _, err := listener.ReadFrom(buffer)
		if err != nil {
			return
		}
		n, peer, err := listener.ReadFrom(buffer)
		if err != nil {
			return
		}
		_, _ = listener.WriteTo(negotiation(buffer[:n]), peer)
	}()
	conn, err := net.Dial("udp", listener.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := probeQUIC(ctx, conn)
	if result.Status != "ok" || result.LatencyMs == nil || *result.LatencyMs < 400 {
		t.Fatalf("%+v", result)
	}
}

func TestQUICRejectsResponseFlood(t *testing.T) {
	listener, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		buffer := make([]byte, 1500)
		_, peer, err := listener.ReadFrom(buffer)
		if err != nil {
			return
		}
		for i := 0; i < 80; i++ {
			_, _ = listener.WriteTo([]byte("invalid"), peer)
		}
	}()
	conn, err := net.Dial("udp", listener.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := probeQUIC(ctx, conn)
	if result.Status != "failed" || result.Reason != "ENTRY_INVALID_RESPONSE" || result.LatencyMs != nil {
		t.Fatalf("%+v", result)
	}
}
