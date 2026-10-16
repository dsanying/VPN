// SPDX-License-Identifier: AGPL-3.0-only
// Separate enterprise runtime. Secrets and interactive replies enter through stdin only.
package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	mdns "github.com/miekg/dns"
	"github.com/mythologyli/zju-connect/client"
	atrust "github.com/mythologyli/zju-connect/client/atrust"
	"github.com/mythologyli/zju-connect/client/atrust/auth"
	"github.com/mythologyli/zju-connect/client/authchallenge"
	easy "github.com/mythologyli/zju-connect/client/easyconnect"
	"github.com/mythologyli/zju-connect/dial"
	"github.com/mythologyli/zju-connect/resolve"
	"github.com/mythologyli/zju-connect/service"
	"github.com/mythologyli/zju-connect/stack/gvisor"
	"github.com/mythologyli/zju-connect/underlay"
	socks "github.com/things-go/go-socks5"
	"inet.af/netaddr"
)

type configuration struct {
	Protocol, Gateway, Username, Password, User, Token string
	Port                                               int
	Selections                                         map[string]string
}

var scanner = bufio.NewScanner(os.Stdin)
var emitMu sync.Mutex

func emit(v any) { emitMu.Lock(); defer emitMu.Unlock(); _ = json.NewEncoder(os.Stdout).Encode(v) }
func reply(v any) error {
	if !scanner.Scan() {
		return fmt.Errorf("authentication cancelled")
	}
	return json.Unmarshal(scanner.Bytes(), v)
}
func challenge(kind, message string, image []byte, loginURL string, response any) error {
	emit(map[string]any{"type": "challenge", "kind": kind, "message": message, "image": base64.StdEncoding.EncodeToString(image), "url": loginURL})
	return reply(response)
}
func handler(gateway *url.URL) authchallenge.Handler {
	return authchallenge.HandlerFuncs{
		Code: func(c authchallenge.CodeChallenge) (r authchallenge.CodeResponse, e error) {
			e = challenge("code", c.Message, nil, "", &r)
			return
		},
		TextCaptcha: func(c authchallenge.TextCaptchaChallenge) (r authchallenge.TextCaptchaResponse, e error) {
			e = challenge("text-captcha", c.Message, c.Image, "", &r)
			return
		},
		ClickCaptcha: func(c authchallenge.ClickCaptchaChallenge) (r authchallenge.ClickCaptchaResponse, e error) {
			e = challenge("click-captcha", c.Message, c.Image, "", &r)
			return
		},
		ExternalLogin: func(c authchallenge.ExternalLoginChallenge) (r authchallenge.ExternalLoginResponse, e error) {
			e = challenge("external", c.Message, nil, c.LoginURL, &r)
			if e == nil {
				e = validateExternalCallback(gateway, c.Kind, r.CallbackURL)
			}
			return
		},
	}
}

// Script-tun uses a socket pair, never installs competing OS routes or a second TUN.
type openConnectClient struct {
	socket    io.ReadWriteCloser
	ip        net.IP
	dns       string
	resources gatewayResources
}

func (c *openConnectClient) IP() (net.IP, error) {
	if c.ip == nil {
		return nil, fmt.Errorf("missing tunnel address")
	}
	return c.ip, nil
}
func (c *openConnectClient) IPSet() (*netaddr.IPSet, error) { return nil, client.ErrResourceNotFound }
func (c *openConnectClient) IPResources() ([]client.IPResource, error) {
	return nil, client.ErrResourceNotFound
}
func (c *openConnectClient) DomainResources() (client.DomainResources, error) {
	return nil, client.ErrResourceNotFound
}
func (c *openConnectClient) DNSResource() (map[string][]net.IP, error) {
	return nil, client.ErrResourceNotFound
}
func (c *openConnectClient) DNSServer() (string, error) {
	if net.ParseIP(c.dns) == nil {
		return "", client.ErrResourceNotFound
	}
	return c.dns, nil
}
func (c *openConnectClient) DNSServers() ([]string, error) { return []string{c.dns}, nil }
func (c *openConnectClient) CanUseTCPTunnel() bool         { return false }
func (c *openConnectClient) DialTCP(context.Context, *net.TCPAddr) (net.Conn, error) {
	return nil, fmt.Errorf("unsupported")
}
func (c *openConnectClient) NewL3Conn() (io.ReadWriteCloser, error) { return c.socket, nil }
func (c *openConnectClient) Close()                                 { _ = c.socket.Close() }

type preparedClient struct {
	client.Client
	conn io.ReadWriteCloser
}

func (c preparedClient) NewL3Conn() (io.ReadWriteCloser, error) { return c.conn, nil }

var failureStage = "authentication"

func run() error {
	log.SetOutput(io.Discard) // Vendor logs can contain session tokens; never forward them.
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	var conf configuration
	var vpn client.Client
	if len(os.Args) > 1 && os.Args[1] == "--openconnect" {
		conf.Gateway = os.Getenv("SHADOW_BRIDGE_GATEWAY")
		conf.User = os.Getenv("SHADOW_BRIDGE_USER")
		conf.Token = os.Getenv("SHADOW_BRIDGE_TOKEN")
		conf.Port, _ = strconv.Atoi(os.Getenv("SHADOW_BRIDGE_PORT"))
		failureStage = "tunnel-socket"
		fd, e := strconv.Atoi(os.Getenv("VPNFD"))
		if e != nil {
			return e
		}
		f := os.NewFile(uintptr(fd), "vpn-socket")
		socket, e := net.FileConn(f)
		_ = f.Close()
		if e != nil {
			return e
		}
		dns := strings.Fields(os.Getenv("INTERNAL_IP4_DNS"))
		server := ""
		if len(dns) > 0 {
			server = dns[0]
		}
		vpn = &openConnectClient{socket: newDatagramTransport(socket), ip: net.ParseIP(os.Getenv("INTERNAL_IP4_ADDRESS")).To4(), dns: server, resources: openConnectResources(os.Getenv)}
	} else {
		if e := reply(&conf); e != nil {
			return e
		}
		gateway, e := url.Parse(conf.Gateway)
		if e != nil || gateway.Scheme != "https" {
			return fmt.Errorf("invalid gateway")
		}
		port := 443
		if gateway.Port() != "" {
			port, e = strconv.Atoi(gateway.Port())
			if e != nil {
				return e
			}
		}
		if len(os.Args) > 1 && os.Args[1] == "--probe" {
			if conf.Protocol != "atrust" {
				return fmt.Errorf("unsupported discovery")
			}
			methods, err := atrust.GetAuthInfoList(gateway.Hostname(), port, "", true, "", "")
			if err != nil {
				return err
			}
			field, err := aTrustAuthField(methods)
			if err != nil {
				return err
			}
			emit(map[string]any{"type": "form", "fields": []any{field}})
			return nil
		}
		transport, e := underlay.New(underlay.Options{AutoDetect: true})
		if e != nil {
			return e
		}
		defer transport.Close()
		switch conf.Protocol {
		case "atrust":
			methods, e := atrust.GetAuthInfoList(gateway.Hostname(), port, "", true, "", "")
			if e != nil {
				return e
			}
			selected, e := selectATrustMethod(methods, conf.Selections["authentication"])
			if e != nil {
				return e
			}
			login, e := auth.NewLoginMethod(auth.LoginMethodOptions{AuthType: selected.AuthType, Domain: selected.LoginDomain, Username: conf.Username, Password: conf.Password, Phone: conf.Username})
			if e != nil {
				return e
			}
			c := atrust.NewClient(atrust.ClientOptions{Session: atrust.SessionOptions{Username: conf.Username}, UnderlayDialer: transport})
			defer c.Close()
			_, e = c.Setup(atrust.SetupOptions{ServerAddress: gateway.Hostname(), ServerPort: port, LoginMethod: login, ChallengeHandler: handler(gateway), SessionRefreshInterval: 30 * time.Minute, BestNodesRefreshInterval: 5 * time.Minute})
			if e != nil {
				return e
			}
			vpn = c
		case "easyconnect":
			c := easy.NewClient(easy.Options{Server: net.JoinHostPort(gateway.Hostname(), strconv.Itoa(port)), Auth: easy.AuthOptions{Username: conf.Username, Password: conf.Password}, Resources: easy.ResourceOptions{Fetch: true, IncludeDomains: true}, UnderlayDialer: transport, ChallengeHandler: handler(gateway)})
			defer c.Close()
			if e = c.Setup(); e != nil {
				return e
			}
			vpn = c
		default:
			return fmt.Errorf("unsupported enterprise engine")
		}
	}
	if conf.Port < 1 || conf.Port > 65535 || conf.User == "" || conf.Token == "" {
		return fmt.Errorf("invalid bridge configuration")
	}
	failureStage = "tunnel-transport"
	conn, e := vpn.NewL3Conn()
	if e != nil {
		return e
	}
	defer conn.Close()
	failureStage = "tunnel-stack"
	stack, e := gvisor.NewStack(preparedClient{Client: vpn, conn: conn})
	if e != nil {
		return e
	}
	dns, _ := vpn.DNSServer()
	domains, _ := vpn.DomainResources()
	dnsResources, _ := vpn.DNSResource()
	resources, _ := vpn.IPResources()
	resolver := resolve.NewResolver(stack, dns, "", 21600, domains, dnsResources, dns != "")
	defer resolver.Close()
	enterpriseDNS := service.NewDnsServer(resolver, []string{dns})
	stack.SetupResolve(enterpriseDNS)
	stack.SetupIPPool(resolver.IPPool)
	vpnDialer := dial.NewDialer(stack, resolver, resources, true, "")
	server := socks.NewServer(socks.WithAuthMethods([]socks.Authenticator{socks.UserPassAuthenticator{Credentials: socks.StaticCredentials{conf.User: conf.Token}}}), socks.WithResolver(resolver), socks.WithDial(func(ctx context.Context, network, address string) (net.Conn, error) {
		host, _, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		if ip := net.ParseIP(host); ip != nil && ip.To4() == nil {
			return nil, fmt.Errorf("enterprise tunnel does not support IPv6")
		}
		return vpnDialer.DialIPPort(ctx, network, address)
	}))
	failureStage = "bridge-listener"
	dnsSocket, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer dnsSocket.Close()
	dnsBridge := &mdns.Server{PacketConn: dnsSocket, Handler: mdns.HandlerFunc(func(w mdns.ResponseWriter, request *mdns.Msg) {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		answer, err := enterpriseDNS.HandleDnsMsg(ctx, request)
		if err != nil {
			answer = new(mdns.Msg)
			answer.SetRcode(request, mdns.RcodeServerFailure)
		}
		_ = w.WriteMsg(answer)
	})}
	defer dnsBridge.Shutdown()
	go func() { _ = dnsBridge.ActivateAndServe() }()
	dnsPort := dnsSocket.LocalAddr().(*net.UDPAddr).Port
	healthSocket, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer healthSocket.Close()
	healthBusy := make(chan struct{}, 1)
	healthServer := &http.Server{ReadHeaderTimeout: 2 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, token, ok := r.BasicAuth()
		if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(conf.User)) != 1 || subtle.ConstantTimeCompare([]byte(token), []byte(conf.Token)) != 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method != "GET" || r.URL.Path != "/health" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		select {
		case healthBusy <- struct{}{}:
			defer func() { <-healthBusy }()
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"availability": checkTunnelGateway(conf.Gateway, vpnDialer.DialIPPort)})
	})}
	defer healthServer.Close()
	go func() { _ = healthServer.Serve(healthSocket) }()
	healthPort := healthSocket.Addr().(*net.TCPAddr).Port

	listener, e := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(conf.Port)))
	if e != nil {
		return e
	}
	defer listener.Close()
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() { <-stop.Done(); _ = listener.Close(); _ = conn.Close() }()
	go func() {
		defer func() {
			if cause := recover(); cause != nil {
				stage := "tunnel-stack"
				if err, ok := cause.(error); ok {
					if errors.Is(err, io.EOF) {
						stage = "tunnel-socket-eof"
					} else if errors.Is(err, net.ErrClosed) {
						stage = "tunnel-socket-closed"
					}
				}
				emit(map[string]string{"type": "error", "stage": stage})
				os.Exit(1)
			}
		}()
		stack.Run()
	}()
	advertised := gatewayResources{Domains: []string{}, CIDRs: []string{}}
	if oc, ok := vpn.(*openConnectClient); ok {
		advertised = oc.resources
	} else {
		for domain := range domains {
			if strings.HasPrefix(domain, "*.") {
				advertised.Suffixes = append(advertised.Suffixes, strings.TrimPrefix(domain, "*."))
			} else {
				advertised.Domains = append(advertised.Domains, domain)
			}
		}
		if set, err := vpn.IPSet(); err == nil && set != nil {
			for _, prefix := range set.Prefixes() {
				if prefix.Bits() >= 8 {
					advertised.CIDRs = append(advertised.CIDRs, prefix.String())
				}
			}
		}
	}
	emit(map[string]any{"type": "ready", "port": conf.Port, "resources": advertised, "dnsPort": dnsPort, "healthPort": healthPort, "availability": checkTunnelGateway(conf.Gateway, vpnDialer.DialIPPort)})
	return server.Serve(listener)
}
func main() {
	if e := run(); e != nil {
		emit(map[string]string{"type": "error", "stage": failureStage})
		os.Exit(1)
	}
}
