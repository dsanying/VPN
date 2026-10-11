package entryprobe

import (
	"bytes"
	"context"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

func TestObfuscationRealUDP(t *testing.T) {
	for _, kind := range []string{"salamander", "gecko"} {
		t.Run(kind, func(t *testing.T) {
			obfs := &Obfs{Type: kind, Password: "example-secret"}
			listener, err := net.ListenPacket("udp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			go func() {
				decoder := deobfuscator{obfs: obfs}
				buffer := make([]byte, 4096)
				for {
					n, peer, err := listener.ReadFrom(buffer)
					if err != nil {
						return
					}
					request := decoder.decode(buffer[:n])
					if len(request) != 1200 {
						continue
					}
					packets, err := obfuscate(negotiation(request), obfs)
					if err != nil {
						return
					}
					// Out-of-order and duplicate fragments cannot alter the final datagram.
					for i := len(packets) - 1; i >= 0; i-- {
						_, _ = listener.WriteTo(packets[i], peer)
						_, _ = listener.WriteTo(packets[i], peer)
					}
					return
				}
			}()
			conn, err := net.Dial("udp", listener.LocalAddr().String())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			result := probeQUICObfs(ctx, conn, obfs)
			if result.Status != "ok" || result.LatencyMs == nil {
				t.Fatalf("%+v", result)
			}
		})
	}
}
func TestObfuscationBoundsAndWrongPassword(t *testing.T) {
	request, _ := quicRequest()
	for _, max := range []int{163, 256, 1200, 2048} {
		o := &Obfs{Type: "gecko", Password: "example-secret", MinPacketSize: 64, MaxPacketSize: max}
		packets, err := obfuscate(request, o)
		if err != nil {
			t.Fatal(err)
		}
		decoder := deobfuscator{obfs: o}
		var final []byte
		for _, packet := range packets {
			if len(packet) > max || len(packet) < 64 {
				t.Fatal("packet bounds")
			}
			final = decoder.decode(packet)
		}
		if !bytes.Equal(final, request) {
			t.Fatal("round trip")
		}
	}
	wrong := &Obfs{Type: "salamander", Password: "wrong-secret"}
	packet, _ := salamander(negotiation(request), "example-secret")
	if validQUICResponse((&deobfuscator{obfs: wrong}).decode(packet), request) {
		t.Fatal("wrong password accepted")
	}
	for _, o := range []*Obfs{{Type: "invalid", Password: "example"}, {Type: "gecko"}, {Type: "gecko", Password: "example", MaxPacketSize: 4096}, {Type: "gecko", Password: "example", MaxPacketSize: 128}} {
		if o.valid() {
			t.Fatal("invalid obfuscation allowed")
		}
	}
}
func TestGeckoMalformedAndBoundedReassembly(t *testing.T) {
	o := &Obfs{Type: "gecko", Password: "example-secret"}
	decoder := deobfuscator{obfs: o}
	for id := 0; id < 32; id++ {
		frame := []byte{0x80, byte(id), 0x02, 0, 0, 1}
		packet, _ := salamander(frame, o.Password)
		decoder.decode(packet)
	}
	if len(decoder.messages) > 16 {
		t.Fatal("unbounded messages")
	}
	for _, frame := range [][]byte{{0x80}, {0x80, 1, 0x02, 255, 255}, {0x80, 1, 0x12, 0, 0}, {0x80, 1, 0x99, 0, 0, 1}} {
		packet, _ := salamander(frame, o.Password)
		if decoder.decode(packet) != nil {
			t.Fatal("malformed fragment accepted")
		}
	}
	frame := make([]byte, 6)
	frame[0], frame[2] = 0x80, 2
	binary.BigEndian.PutUint16(frame[3:5], 0)
	packet, _ := salamander(frame, o.Password)
	decoder.decode(packet)
}
