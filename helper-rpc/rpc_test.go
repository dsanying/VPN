package helperrpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestStandardRequests(t *testing.T) {
	var calls [][]string
	var mu sync.Mutex
	handler := NewHandler([]string{"echo"}, Bearer(func() string { return "test-token" }), func(_ context.Context, _ string, args *Arguments) string {
		mu.Lock()
		calls = append(calls, args.Values)
		mu.Unlock()
		return "OK echoed"
	})
	run := func(body, token string) (*httptest.ResponseRecorder, map[string]any) {
		r := httptest.NewRequest(http.MethodPost, "/rpc", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var response map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &response)
		return w, response
	}
	w, response := run(`{"jsonrpc":"2.0","method":"echo","params":["path\nwith newline"],"id":"request-1"}`, "test-token")
	if w.Code != 200 || response["jsonrpc"] != "2.0" || response["id"] != "request-1" || calls[0][0] != "path\nwith newline" {
		t.Fatalf("invalid response %d %v %v", w.Code, response, calls)
	}
	before := len(calls)
	w, _ = run(`{"jsonrpc":"2.0","method":"echo","id":1}`, "wrong")
	if w.Code != 401 || len(calls) != before {
		t.Fatal("unauthorized call executed")
	}
	for _, item := range []struct {
		body string
		code float64
	}{{`{`, -32700}, {`{"jsonrpc":"2.0","method":"missing","id":2}`, -32601}, {`{"jsonrpc":"2.0","method":"echo","params":[3],"id":3}`, -32602}} {
		_, response = run(item.body, "test-token")
		err, ok := response["error"].(map[string]any)
		if !ok || err["code"] != item.code {
			t.Fatalf("error response %v", response)
		}
	}
	w, _ = run(`[{"jsonrpc":"2.0","method":"echo","id":1},{"jsonrpc":"2.0","method":"echo","id":2}]`, "test-token")
	var batch []any
	if json.Unmarshal(w.Body.Bytes(), &batch) != nil || len(batch) != 2 {
		t.Fatal("batch failed")
	}
	w, _ = run(`{"jsonrpc":"2.0","method":"echo"}`, "test-token")
	if w.Code != 204 || w.Body.Len() != 0 {
		t.Fatal("notification returned response")
	}
	before = len(calls)
	w, _ = run(`{"jsonrpc":"2.0","method":"echo","params":["`+strings.Repeat("x", 70000)+`"],"id":4}`, "test-token")
	if len(calls) != before || w.Code != 413 {
		t.Fatal("oversized request executed")
	}
}

func TestProtocolEdgeCases(t *testing.T) {
	var calls atomic.Int32
	h := NewHandler([]string{"echo"}, nil, func(ctx context.Context, _ string, _ *Arguments) string {
		if ctx.Value(contextKey{}) != "trusted-peer" {
			t.Error("HTTP authorization context lost")
		}
		calls.Add(1)
		return "OK echoed"
	})
	for _, tt := range []struct {
		body                   string
		status, code, executed int
		hasID                  bool
	}{
		{`null`, 200, -32600, 0, true}, {`[]`, 200, -32600, 0, true}, {`{`, 200, -32700, 0, true},
		{`{"jsonrpc":"2.0","method":"echo","id":true}`, 200, -32600, 0, true},
		{`{"jsonrpc":"2.0","method":"echo","id":null}`, 200, 0, 1, true},
		{`{"jsonrpc":"2.0","method":"echo"}`, 204, 0, 1, false},
	} {
		t.Run(tt.body, func(t *testing.T) {
			before := calls.Load()
			r := httptest.NewRequest("POST", "/rpc", strings.NewReader(tt.body))
			r.ContentLength = -1
			r = r.WithContext(context.WithValue(r.Context(), contextKey{}, "trusted-peer"))
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tt.status || int(calls.Load()-before) != tt.executed {
				t.Fatalf("status=%d executed=%d body=%s", w.Code, calls.Load()-before, w.Body)
			}
			if tt.hasID {
				var reply map[string]any
				if err := json.Unmarshal(w.Body.Bytes(), &reply); err != nil {
					t.Fatal(err)
				}
				if _, ok := reply["id"]; !ok {
					t.Fatalf("id missing: %s", w.Body)
				}
				if tt.code != 0 && reply["error"].(map[string]any)["code"] != float64(tt.code) {
					t.Fatalf("wrong error %s", w.Body)
				}
			} else if w.Body.Len() != 0 {
				t.Fatal("notification must have no response")
			}
		})
	}
	r := httptest.NewRequest("POST", "/rpc", strings.NewReader(`  [{"jsonrpc":"2.0","method":"echo"},{"jsonrpc":"2.0","method":"echo","id":"batch"}]`))
	r.ContentLength = -1
	r = r.WithContext(context.WithValue(r.Context(), contextKey{}, "trusted-peer"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var batch []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &batch); err != nil || len(batch) != 1 || batch[0]["id"] != "batch" {
		t.Fatalf("mixed batch %s", w.Body)
	}
}

type contextKey struct{}
