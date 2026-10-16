// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"errors"
	"io"
	"net"
	"syscall"
	"testing"
	"time"
)

type packetFixture struct {
	attempts int
	failures int
	err      error
	received []byte
}

func (f *packetFixture) Read([]byte) (int, error) { return 0, io.EOF }
func (f *packetFixture) Close() error             { return nil }
func (f *packetFixture) Write(b []byte) (int, error) {
	f.attempts++
	if f.attempts <= f.failures {
		return 0, f.err
	}
	f.received = append([]byte(nil), b...)
	return len(b), nil
}
func TestDatagramQueuePressure(t *testing.T) {
	f := &packetFixture{failures: 3, err: syscall.ENOBUFS}
	d := newDatagramTransport(f)
	packet := []byte{0x45, 0, 0, 20}
	n, err := d.Write(packet)
	if err != nil || n != len(packet) || f.attempts != 4 || !bytes.Equal(packet, f.received) {
		t.Fatalf("packet was lost or altered: %d %v", n, err)
	}
}
func TestDatagramFatalError(t *testing.T) {
	f := &packetFixture{failures: 100, err: syscall.EPIPE}
	d := newDatagramTransport(f)
	_, err := d.Write([]byte{1})
	if !errors.Is(err, syscall.EPIPE) || f.attempts != 1 {
		t.Fatal("fatal error retried")
	}
}
func TestDatagramPressureBounded(t *testing.T) {
	f := &packetFixture{failures: 100000, err: syscall.ENOBUFS}
	d := newDatagramTransport(f)
	d.timeout = 10 * time.Millisecond
	_, err := d.Write([]byte{1})
	if !errors.Is(err, syscall.ENOBUFS) {
		t.Fatal("exhausted pressure hidden")
	}
	d.Close()
	_, err = d.Write([]byte{1})
	if !errors.Is(err, net.ErrClosed) {
		t.Fatal("closed tunnel accepted a packet")
	}
}
