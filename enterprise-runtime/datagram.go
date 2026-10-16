// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"errors"
	"io"
	"net"
	"sync"
	"syscall"
	"time"
)

// A datagram write must remain one packet. Kernel queue pressure is temporary,
// not a broken tunnel; serialize and retry without silently dropping packets.
type datagramTransport struct {
	io.ReadWriteCloser
	mu      sync.Mutex
	done    chan struct{}
	once    sync.Once
	timeout time.Duration
}

func newDatagramTransport(conn io.ReadWriteCloser) *datagramTransport {
	return &datagramTransport{ReadWriteCloser: conn, done: make(chan struct{}), timeout: 5 * time.Second}
}
func (d *datagramTransport) Close() error {
	d.once.Do(func() { close(d.done) })
	return d.ReadWriteCloser.Close()
}
func (d *datagramTransport) Write(packet []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	deadline := time.Now().Add(d.timeout)
	for {
		select {
		case <-d.done:
			return 0, net.ErrClosed
		default:
		}
		n, err := d.ReadWriteCloser.Write(packet)
		if err == nil || n != 0 {
			return n, err
		}
		if !errors.Is(err, syscall.ENOBUFS) && !errors.Is(err, syscall.EAGAIN) && !errors.Is(err, syscall.EINTR) {
			return n, err
		}
		if !time.Now().Before(deadline) {
			return n, err
		}
		timer := time.NewTimer(time.Millisecond)
		select {
		case <-d.done:
			timer.Stop()
			return 0, net.ErrClosed
		case <-timer.C:
		}
	}
}
