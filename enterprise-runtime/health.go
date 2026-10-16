// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"time"
)

// A completed authenticated handshake alone does not prove that the data plane forwards packets.
// Request the configured gateway through the VPN dialer with normal TLS verification, no direct fallback.
// This is availability evidence; it is deliberately not reported as an internal-site latency.
func checkTunnelGateway(gateway string, dial func(context.Context, string, string) (net.Conn, error)) string {
	parsed, err := url.Parse(gateway)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "unknown"
	}
	transport := &http.Transport{DialContext: dial, DisableKeepAlives: true, TLSHandshakeTimeout: 4 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(parsed.String())
	if err != nil {
		return "unknown"
	}
	_ = response.Body.Close()
	return "available"
}
