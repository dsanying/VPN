// Package helperrpc serves JSON-RPC 2.0 over local HTTP connections.
// Standard framing/batch/notification/error handling comes from creachadair/jrpc2.
package helperrpc

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/creachadair/jrpc2"
	"github.com/creachadair/jrpc2/handler"
	"github.com/creachadair/jrpc2/jhttp"
)

const Version = "0.1.0"

// Arguments is a business argument list, not a wire parser. JSON preserves all path characters.
type Arguments struct {
	Values []string
	offset int
}

func (a *Arguments) Next() string {
	if a.offset >= len(a.Values) {
		return ""
	}
	v := a.Values[a.offset]
	a.offset++
	return v
}

type Result struct {
	State        string   `json:"state"`
	PID          int      `json:"pid,omitempty"`
	UID          *int     `json:"uid,omitempty"`
	Detail       string   `json:"detail,omitempty"`
	Version      string   `json:"version,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
}

// DecodeOutcome adapts existing internal command outcomes to structured results.
// No line-based requests or responses are exposed on the socket/pipe.
func DecodeOutcome(message string, methods []string) (Result, *jrpc2.Error) {
	message = strings.TrimSpace(message)
	if !strings.HasPrefix(message, "OK ") {
		return Result{}, &jrpc2.Error{Code: -32000, Message: strings.TrimPrefix(message, "ERR ")}
	}
	fields := strings.SplitN(strings.TrimPrefix(message, "OK "), " ", 2)
	result := Result{State: fields[0]}
	if len(fields) > 1 {
		result.Detail = fields[1]
	}
	if result.State == "pong" {
		var uid int
		if _, err := fmt.Sscanf(result.Detail, "uid=%d", &uid); err != nil {
			return Result{}, &jrpc2.Error{Code: -32603, Message: "invalid helper identity"}
		}
		result.UID = &uid
		result.Detail = ""
		result.Version = Version
		result.Capabilities = methods
	} else if result.State == "running" || result.State == "stopping" || result.State == "started" || result.State == "already" || result.State == "stopped" {
		if pid, err := strconv.Atoi(result.Detail); err == nil {
			result.PID = pid
			result.Detail = ""
		}
	}
	return result, nil
}

type Execute func(context.Context, string, *Arguments) string
type Authorize func(*http.Request) bool

func Bearer(token func() string) Authorize {
	return func(r *http.Request) bool {
		expected := token()
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		return expected != "" && r.Header.Get("Authorization") == "Bearer "+got && subtle.ConstantTimeCompare([]byte(got), []byte(expected)) == 1
	}
}

func NewHandler(methods []string, authorize Authorize, execute Execute) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rpc" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			http.Error(w, "method not allowed", 405)
			return
		}
		if authorize != nil && !authorize(r) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="helper"`)
			http.Error(w, "unauthorized", 401)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "request body too large or unreadable", http.StatusRequestEntityTooLarge)
			return
		}
		requests := parseRequests(body)
		mux := handler.Map{}
		for _, method := range methods {
			method := method
			mux[method] = func(ctx context.Context, request *jrpc2.Request) (any, error) {
				values := []string{}
				if err := request.UnmarshalParams(&values); err != nil {
					return nil, err
				}
				if len(values) > 16 {
					return nil, &jrpc2.Error{Code: -32602, Message: "too many arguments"}
				}
				for _, value := range values {
					if len(value) > 8192 || strings.ContainsRune(value, 0) {
						return nil, &jrpc2.Error{Code: -32602, Message: "invalid argument"}
					}
				}
				result, err := DecodeOutcome(execute(ctx, method, &Arguments{Values: values}), methods)
				if err != nil {
					return nil, err
				}
				return result, nil
			}
		}
		// A per-HTTP-request bridge preserves SO_PEERCRED/cancellation context and closes all worker goroutines.
		bridge := jhttp.NewBridge(mux, &jhttp.BridgeOptions{
			Server:       &jrpc2.ServerOptions{NewContext: func() context.Context { return r.Context() }},
			ParseRequest: func(*http.Request) ([]*jrpc2.ParsedRequest, error) { return requests, nil },
		})
		defer bridge.Close()
		bridge.ServeHTTP(w, r)
	})
}

// ParseRequests validates the protocol in the maintained library. HTTP bridge edge cases
// normalize empty batches and preserve an explicit null ID (a call, unlike an absent ID).
func parseRequests(body []byte) []*jrpc2.ParsedRequest {
	failure := func(code jrpc2.Code, message string) []*jrpc2.ParsedRequest {
		return []*jrpc2.ParsedRequest{{ID: "null", Error: &jrpc2.Error{Code: code, Message: message}}}
	}
	requests, err := jrpc2.ParseRequests(body)
	if err != nil {
		return failure(jrpc2.ParseError, "parse error")
	}
	if len(requests) == 0 {
		return failure(jrpc2.InvalidRequest, "empty batch")
	}
	var raw []json.RawMessage
	if bytes.HasPrefix(bytes.TrimSpace(body), []byte("[")) {
		_ = json.Unmarshal(body, &raw)
	} else {
		raw = []json.RawMessage{body}
	}
	for i, request := range requests {
		if request.Error != nil || request.ID != "" {
			continue
		}
		var header struct {
			ID json.RawMessage `json:"id"`
		}
		if json.Unmarshal(raw[i], &header) == nil && bytes.Equal(bytes.TrimSpace(header.ID), []byte("null")) {
			request.ID = "null"
		}
	}
	return requests
}

func Serve(listener net.Listener, handler http.Handler, connContext func(context.Context, net.Conn) context.Context) error {
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192, ConnContext: connContext}
	return server.Serve(listener)
}
