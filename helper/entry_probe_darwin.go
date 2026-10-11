package main

import (
	"context"
	"net"
	"shadowvpn/helperrpc/entryprobe"
)

type entryProbeInput = entryprobe.Input
type entryProbeResult = entryprobe.Result

func runEntryProbeCommand() bool { return entryprobe.RunCommand() }
func dialBoundEntry(ctx context.Context, input entryProbeInput, iface net.Interface) entryProbeResult {
	return entryprobe.DialBoundEntry(ctx, input, iface)
}
