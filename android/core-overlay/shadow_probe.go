// SPDX-License-Identifier: GPL-3.0-or-later

package libbox

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/adapter"
	M "github.com/sagernet/sing/common/metadata"
	"github.com/sagernet/sing/service"
)

// AndroidNodeProbe owns an isolated engine with no listeners or VPN interface.
// It never selects or reloads the user's active exit.
type AndroidNodeProbe struct {
	context  context.Context
	cancel   context.CancelFunc
	platform PlatformInterface
	mutex    sync.Mutex
	used     bool
}
type AndroidProbeResult struct {
	LatencyMS      int64
	StatusCode     int32
	Failure        string
	EntryLatencyMS int64
	EntryFailure   string
	Body           string
}

func NewAndroidNodeProbe(platform PlatformInterface) *AndroidNodeProbe {
	ctx, cancel := context.WithTimeout(baseContext(platform), 15*time.Second)
	return &AndroidNodeProbe{context: ctx, cancel: cancel, platform: platform}
}
func (p *AndroidNodeProbe) Cancel() { p.cancel() }
func (p *AndroidNodeProbe) Run(configContent string, tag string, target string, serverAddress string, serverPort int32) (*AndroidProbeResult, error) {
	p.mutex.Lock()
	if p.used {
		p.mutex.Unlock()
		return nil, errors.New("probe already used")
	}
	p.used = true
	p.mutex.Unlock()
	defer p.cancel()
	endpoint, err := url.Parse(target)
	if err != nil || endpoint.Scheme != "https" || endpoint.Hostname() == "" || endpoint.User != nil {
		return nil, errors.New("invalid HTTPS probe target")
	}
	if serverAddress == "" || serverPort < 1 || serverPort > 65535 {
		return nil, errors.New("invalid entry endpoint")
	}
	options, err := parseConfig(p.context, configContent)
	if err != nil {
		return nil, errors.New("invalid probe configuration")
	}
	if len(options.Inbounds) != 0 || len(options.Services) != 0 {
		return nil, errors.New("probe cannot own inbound listeners or services")
	}
	ctx := p.context
	if p.platform != nil {
		ctx = service.ContextWith[adapter.PlatformInterface](ctx, &platformInterfaceWrapper{iif: p.platform, useProcFS: false})
	}
	engine, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		return nil, errors.New("cannot prepare probe engine")
	}
	defer engine.Close()
	if err = engine.Start(); err != nil {
		return nil, errors.New("cannot start probe engine")
	}
	outbound, found := engine.Outbound().Outbound(tag)
	if !found {
		endpoint, endpointFound := engine.Endpoint().Get(tag)
		if !endpointFound {
			return nil, errors.New("probe outbound not found")
		}
		outbound = endpoint
	}
	result := &AndroidProbeResult{LatencyMS: -1, EntryLatencyMS: -1}
	direct, found := engine.Outbound().Outbound("direct")
	if !found {
		return nil, errors.New("probe direct outbound not found")
	}
	entryContext, cancelEntry := context.WithTimeout(ctx, 3*time.Second)
	entryStarted := time.Now()
	connection, entryErr := direct.DialContext(entryContext, "tcp", M.ParseSocksaddrHostPort(serverAddress, uint16(serverPort)))
	if entryErr == nil {
		result.EntryLatencyMS = time.Since(entryStarted).Milliseconds()
		connection.Close()
	} else {
		result.EntryFailure = "connect-failed"
		if errors.Is(entryContext.Err(), context.DeadlineExceeded) {
			result.EntryFailure = "timeout"
		}
	}
	cancelEntry()
	transport := &http.Transport{
		Proxy:           nil,
		TLSClientConfig: &tls.Config{RootCAs: adapter.RootPoolFromContext(ctx), MinVersion: tls.VersionTLS12},
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			destination := M.ParseSocksaddr(address)
			return outbound.DialContext(ctx, network, destination)
		},
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		DisableKeepAlives:     true,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 || request.URL.Scheme != "https" || request.URL.User != nil {
			return errors.New("unsafe probe redirect")
		}
		return nil
	}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, errors.New("invalid probe request")
	}
	started := time.Now()
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, errors.New("probe cancelled")
		}
		failure := "request-failed"
		var networkError net.Error
		if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.As(err, &networkError) && networkError.Timeout() {
			failure = "timeout"
		}
		var certificateError x509.UnknownAuthorityError
		var hostnameError x509.HostnameError
		var invalidCertificate x509.CertificateInvalidError
		if errors.As(err, &certificateError) || errors.As(err, &hostnameError) || errors.As(err, &invalidCertificate) {
			failure = "tls-error:CERT_REJECTED"
		}
		result.Failure = failure
		return result, nil
	}
	defer response.Body.Close()
	result.LatencyMS = time.Since(started).Milliseconds()
	result.StatusCode = int32(response.StatusCode)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		result.LatencyMS = -1
		result.Failure = fmt.Sprintf("http-%d", response.StatusCode)
	}
	if result.Failure == "" {
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
		if readErr != nil || len(body) > 64*1024 {
			result.LatencyMS = -1
			result.Failure = "response-body-invalid"
		} else {
			result.Body = string(body)
		}
	}
	return result, nil
}
