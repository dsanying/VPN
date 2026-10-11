// SPDX-License-Identifier: GPL-3.0-or-later

package libbox

import (
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func shadowProbeConfig(t *testing.T, server *httptest.Server, trusted bool) string {
	t.Helper()
	document := map[string]any{"log": map[string]any{"disabled": true}, "outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}}, "route": map[string]any{"final": "direct"}}
	if trusted {
		document["certificate"] = map[string]any{"certificate": []string{string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}))}}
	}
	data, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
func TestShadowProbeVerifiedHTTPSResponse(t *testing.T) {
	for _, code := range []int{http.StatusNoContent, http.StatusForbidden} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(code) }))
			server.Config.ErrorLog = log.New(io.Discard, "", 0)
			server.StartTLS()
			defer server.Close()
			address := server.Listener.Addr().(*net.TCPAddr)
			result, err := NewAndroidNodeProbe(nil).Run(shadowProbeConfig(t, server, true), "direct", server.URL, "127.0.0.1", int32(address.Port))
			if err != nil {
				t.Fatal(err)
			}
			if result.EntryLatencyMS < 0 {
				t.Fatal("physical entry was not measured")
			}
			if int(result.StatusCode) != code {
				t.Fatalf("unexpected status %d", result.StatusCode)
			}
			if code == 204 && result.LatencyMS < 0 {
				t.Fatalf("verified HTTPS request failed: %s", result.Failure)
			}
			if code == 403 && (result.LatencyMS != -1 || result.Failure != "http-403") {
				t.Fatal("error response treated as usable")
			}
		})
	}
}
func TestShadowProbeRejectsUntrustedCertificate(t *testing.T) {
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	defer server.Close()
	address := server.Listener.Addr().(*net.TCPAddr)
	result, err := NewAndroidNodeProbe(nil).Run(shadowProbeConfig(t, server, false), "direct", server.URL, "127.0.0.1", int32(address.Port))
	if err != nil {
		t.Fatal(err)
	}
	if result.LatencyMS != -1 || result.Failure != "tls-error:CERT_REJECTED" {
		t.Fatalf("untrusted certificate was not rejected: %+v", result)
	}
}
func TestShadowProbeRejectsUnsafeTargetAndCancellation(t *testing.T) {
	for _, target := range []string{"http://example.com/", "https://user:password@example.com/"} {
		if _, err := NewAndroidNodeProbe(nil).Run("{}", "direct", target, "127.0.0.1", 443); err == nil {
			t.Fatal("unsafe target accepted")
		}
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	defer server.Close()
	endpoint, _ := url.Parse(server.URL)
	address := server.Listener.Addr().(*net.TCPAddr)
	probe := NewAndroidNodeProbe(nil)
	probe.Cancel()
	result, err := probe.Run(shadowProbeConfig(t, server, true), "direct", endpoint.String(), "127.0.0.1", int32(address.Port))
	if err == nil || result != nil {
		t.Fatal("cancelled probe returned an observation")
	}
}

func TestShadowProbeUsesSpecifiedOutbound(t *testing.T) {
	target := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	target.Config.ErrorLog = log.New(io.Discard, "", 0)
	target.StartTLS()
	defer target.Close()
	var requests atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodConnect {
			w.WriteHeader(405)
			return
		}
		requests.Add(1)
		remote, err := net.Dial("tcp", request.Host)
		if err != nil {
			w.WriteHeader(502)
			return
		}
		client, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			remote.Close()
			return
		}
		_, err = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
		if err != nil {
			client.Close()
			remote.Close()
			return
		}
		go func() { defer client.Close(); defer remote.Close(); io.Copy(remote, client) }()
		io.Copy(client, remote)
	}))
	defer proxy.Close()
	address := proxy.Listener.Addr().(*net.TCPAddr)
	var document map[string]any
	if err := json.Unmarshal([]byte(shadowProbeConfig(t, target, true)), &document); err != nil {
		t.Fatal(err)
	}
	document["outbounds"] = []any{map[string]any{"type": "direct", "tag": "direct"}, map[string]any{"type": "http", "tag": "exact-node", "server": "127.0.0.1", "server_port": address.Port}}
	content, _ := json.Marshal(document)
	result, err := NewAndroidNodeProbe(nil).Run(string(content), "exact-node", target.URL, "127.0.0.1", int32(address.Port))
	if err != nil {
		t.Fatal(err)
	}
	if result.LatencyMS < 0 || requests.Load() != 1 {
		t.Fatalf("exact outbound was not used: %+v, CONNECT=%d", result, requests.Load())
	}
}

func TestShadowProbeReturnsBoundedVerifiedBody(t *testing.T) {
	for _, body := range []string{"ip=192.0.2.1\nloc=US", strings.Repeat("a", 64*1024+1)} {
		server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, body) }))
		server.Config.ErrorLog = log.New(io.Discard, "", 0)
		server.StartTLS()
		address := server.Listener.Addr().(*net.TCPAddr)
		result, err := NewAndroidNodeProbe(nil).Run(shadowProbeConfig(t, server, true), "direct", server.URL, "127.0.0.1", int32(address.Port))
		server.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(body) <= 64*1024 {
			if result.Body != body || result.Failure != "" {
				t.Fatal("verified response body missing")
			}
		} else if result.Body != "" || result.Failure != "response-body-invalid" || result.LatencyMS >= 0 {
			t.Fatal("oversized response accepted")
		}
	}
}
