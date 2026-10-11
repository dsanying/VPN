package entryprobe

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"strconv"
	"syscall"
	"time"
)

type Input struct {
	Address   string `json:"address"`
	Port      int    `json:"port"`
	Transport string `json:"transport,omitempty"`
	Obfs      *Obfs  `json:"obfs,omitempty"`
}
type Result struct {
	Status    string `json:"status"`
	LatencyMs *int64 `json:"latencyMs,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// An unprivileged, one-shot mode of the bundled executable. It never starts the
// helper service, reads credentials, changes routes, or installs anything.
func RunCommand() bool {
	if len(os.Args) != 2 || os.Args[1] != "--entry-probe" {
		return false
	}
	result := Result{Status: "failed", Reason: "INVALID_ENDPOINT"}
	var input Input
	if json.NewDecoder(io.LimitReader(os.Stdin, 8192)).Decode(&input) == nil && net.ParseIP(input.Address) != nil && input.Port > 0 && input.Port <= 65535 && input.Obfs.valid() && (input.Transport == "" || input.Transport == "tcp" || input.Transport == "quic") {
		result = measureBoundEntry(input)
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
	return true
}

func measureBoundEntry(input Input) Result {
	interfaces, err := net.Interfaces()
	if err != nil {
		return Result{Status: "unavailable", Reason: "INTERFACE_UNAVAILABLE"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	results := make(chan Result, len(interfaces))
	count := 0
	for _, iface := range interfaces {
		if !physicalInterface(iface) || iface.Flags&net.FlagUp == 0 {
			continue
		}
		count++
		go func(iface net.Interface) { results <- DialBoundEntry(ctx, input, iface) }(iface)
	}
	if count == 0 {
		return Result{Status: "unavailable", Reason: "INTERFACE_UNAVAILABLE"}
	}
	last := Result{Status: "failed", Reason: "ENTRY_CONNECT_FAILED"}
	for i := 0; i < count; i++ {
		result := <-results
		if result.Status == "ok" {
			return result
		}
		last = result
	}
	return last
}

func DialBoundEntry(ctx context.Context, input Input, iface net.Interface) Result {
	if iface.Index <= 0 || iface.Name == "" {
		return Result{Status: "unavailable", Reason: "INTERFACE_BIND_FAILED"}
	}
	bindFailed := false
	dialer := net.Dialer{Control: func(network, address string, raw syscall.RawConn) error {
		err := bindInterface(network, raw, iface)
		bindFailed = err != nil
		return err
	}}
	start := time.Now()
	network := "tcp"
	if input.Transport == "quic" {
		network = "udp"
	}
	conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(input.Address, strconv.Itoa(input.Port)))
	elapsed := time.Since(start).Milliseconds()
	if err == nil {
		defer conn.Close()
		if input.Transport == "quic" {
			return probeQUICObfs(ctx, conn, input.Obfs)
		}
		_ = conn.Close()
		return Result{Status: "ok", LatencyMs: &elapsed}
	}
	if bindFailed {
		return Result{Status: "unavailable", Reason: "INTERFACE_BIND_FAILED"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Result{Status: "timeout"}
	}
	reason := "ENTRY_CONNECT_FAILED"
	for _, code := range []syscall.Errno{syscall.ECONNREFUSED, syscall.ENETUNREACH, syscall.EHOSTUNREACH, syscall.ECONNRESET} {
		if errors.Is(err, code) {
			switch code {
			case syscall.ECONNREFUSED:
				reason = "ECONNREFUSED"
			case syscall.ENETUNREACH:
				reason = "ENETUNREACH"
			case syscall.EHOSTUNREACH:
				reason = "EHOSTUNREACH"
			case syscall.ECONNRESET:
				reason = "ECONNRESET"
			}
		}
	}
	return Result{Status: "failed", Reason: reason}
}
