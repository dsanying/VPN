// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthNeverUsesDirectFallbackOrDisablesTLS(t *testing.T) {
	called := false
	dial := func(context.Context, string, string) (net.Conn, error) { called = true; return nil, net.ErrClosed }
	if checkTunnelGateway("https://example.com/", dial) != "unknown" || !called {
		t.Fatal("VPN dialer must be used")
	}
	called = false
	if checkTunnelGateway("http://example.com/", dial) != "unknown" || called {
		t.Fatal("insecure target must be rejected")
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer server.Close()
	forwarded := 0
	if checkTunnelGateway(server.URL, func(ctx context.Context, network, address string) (net.Conn, error) {
		forwarded++
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}) != "unknown" || forwarded != 1 {
		t.Fatal("untrusted TLS must not report availability")
	}
}
