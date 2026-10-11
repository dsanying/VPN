package main

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestBoundEntryRealIPv4AndIPv6(t *testing.T) {
	iface, err := net.InterfaceByName("lo0")
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"127.0.0.1", "::1"} {
		t.Run(address, func(t *testing.T) {
			listener, err := net.Listen("tcp", net.JoinHostPort(address, "0"))
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			result := dialBoundEntry(ctx, entryProbeInput{Address: address, Port: listener.Addr().(*net.TCPAddr).Port}, *iface)
			if result.Status != "ok" || result.LatencyMs == nil || *result.LatencyMs < 0 {
				t.Fatalf("%+v", result)
			}
		})
	}
}
func TestBoundEntryRefusedPort(t *testing.T) {
	iface, err := net.InterfaceByName("lo0")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := dialBoundEntry(ctx, entryProbeInput{Address: "127.0.0.1", Port: port}, *iface)
	if result.Status != "failed" || result.Reason != "ECONNREFUSED" || result.LatencyMs != nil {
		t.Fatalf("%+v", result)
	}
}
func TestBoundEntryCannotFallBackWhenInterfaceBindingFails(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := dialBoundEntry(ctx, entryProbeInput{Address: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port}, net.Interface{Index: 2147483647})
	if result.Status != "unavailable" || result.Reason != "INTERFACE_BIND_FAILED" || result.LatencyMs != nil {
		t.Fatalf("binding failure produced success: %+v", result)
	}
}

func TestBoundQUICRealPhysicalSocketBinding(t *testing.T) {
	iface, err := net.InterfaceByName("lo0")
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		buffer := make([]byte, 1500)
		n, peer, err := listener.ReadFrom(buffer)
		if err != nil || n != 1200 {
			return
		}
		reply := make([]byte, 27)
		reply[0], reply[5], reply[14], reply[26] = 0x80, 8, 8, 1
		copy(reply[6:14], buffer[15:23])
		copy(reply[15:23], buffer[6:14])
		_, _ = listener.WriteTo(reply, peer)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result := dialBoundEntry(ctx, entryProbeInput{Address: "127.0.0.1", Port: listener.LocalAddr().(*net.UDPAddr).Port, Transport: "quic"}, *iface)
	if result.Status != "ok" || result.LatencyMs == nil {
		t.Fatalf("%+v", result)
	}
}
