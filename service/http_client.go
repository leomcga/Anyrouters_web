package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gorilla/websocket"
	"golang.org/x/net/proxy"
)

var (
	httpClient      *http.Client
	proxyClientLock sync.Mutex
	proxyClients    = make(map[string]*http.Client)
)

type rejectedOutboundRoundTripper struct {
	err error
}

func (r rejectedOutboundRoundTripper) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, r.err
}

func currentOutboundPolicy() common.OutboundSecurityPolicy {
	fetchSetting := system_setting.GetFetchSetting()
	allowedPorts, err := common.ParseOutboundPortRanges(fetchSetting.AllowedPorts)
	if err != nil {
		allowedPorts = []int{80, 443}
	}
	return common.OutboundSecurityPolicy{
		AllowHTTP:             common.OutboundAllowHTTP,
		AllowPrivateIP:        fetchSetting.AllowPrivateIp,
		AllowedPorts:          allowedPorts,
		DomainFilterMode:      fetchSetting.DomainFilterMode,
		DomainList:            append([]string(nil), fetchSetting.DomainList...),
		IPFilterMode:          fetchSetting.IpFilterMode,
		IPList:                append([]string(nil), fetchSetting.IpList...),
		TrustedDomains:        append([]string(nil), common.OutboundTrustedDomains...),
		MaxRedirects:          common.OutboundMaxRedirects,
		MaxRequestBodyBytes:   common.OutboundMaxRequestBodyBytes,
		MaxResponseBodyBytes:  common.OutboundMaxResponseBodyBytes,
		ConnectTimeout:        time.Duration(common.OutboundConnectTimeoutSeconds) * time.Second,
		TLSHandshakeTimeout:   time.Duration(common.OutboundTLSHandshakeTimeoutSeconds) * time.Second,
		ResponseHeaderTimeout: time.Duration(common.OutboundResponseHeaderTimeoutSeconds) * time.Second,
		IdleConnTimeout:       time.Duration(common.RelayIdleConnTimeout) * time.Second,
		RequestTimeout:        outboundRequestTimeout(),
	}
}

func outboundRequestTimeout() time.Duration {
	if common.RelayTimeout > 0 {
		return time.Duration(common.RelayTimeout) * time.Second
	}
	return time.Duration(common.OutboundRequestTimeoutSeconds) * time.Second
}

func ValidateOutboundSecurityConfig() error {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if environment != "production" && environment != "prod" {
		return nil
	}
	fetchSetting := system_setting.GetFetchSetting()
	if !fetchSetting.EnableSSRFProtection {
		return errors.New("production requires SSRF protection to remain enabled")
	}
	if fetchSetting.AllowPrivateIp {
		return errors.New("production forbids private outbound IP access")
	}
	if !fetchSetting.ApplyIPFilterForDomain {
		return errors.New("production requires outbound DNS IP validation")
	}
	if common.TLSInsecureSkipVerify {
		return errors.New("production forbids TLS_INSECURE_SKIP_VERIFY")
	}
	if common.OutboundAllowHTTP {
		return errors.New("production requires OUTBOUND_ALLOW_HTTP=false")
	}
	values := map[string]int64{
		"OUTBOUND_MAX_REDIRECTS":                   int64(common.OutboundMaxRedirects),
		"OUTBOUND_MAX_REQUEST_BYTES":               common.OutboundMaxRequestBodyBytes,
		"OUTBOUND_MAX_RESPONSE_BYTES":              common.OutboundMaxResponseBodyBytes,
		"OUTBOUND_CONNECT_TIMEOUT_SECONDS":         int64(common.OutboundConnectTimeoutSeconds),
		"OUTBOUND_TLS_HANDSHAKE_TIMEOUT_SECONDS":   int64(common.OutboundTLSHandshakeTimeoutSeconds),
		"OUTBOUND_RESPONSE_HEADER_TIMEOUT_SECONDS": int64(common.OutboundResponseHeaderTimeoutSeconds),
		"OUTBOUND_REQUEST_TIMEOUT_SECONDS":         int64(common.OutboundRequestTimeoutSeconds),
	}
	for name, value := range values {
		if value <= 0 {
			return fmt.Errorf("production requires %s to be a positive integer", name)
		}
	}
	return nil
}

func InitHttpClient() error {
	client, err := common.NewSecureHTTPClient(common.OutboundClientConfig{
		PolicyProvider: currentOutboundPolicy,
	})
	if err != nil {
		return err
	}
	httpClient = client
	return nil
}

func GetHttpClient() *http.Client {
	if httpClient != nil {
		return httpClient
	}
	client, err := common.NewSecureHTTPClient(common.OutboundClientConfig{
		PolicyProvider: currentOutboundPolicy,
	})
	if err != nil {
		return &http.Client{
			Transport: rejectedOutboundRoundTripper{err: err},
			Timeout:   outboundRequestTimeout(),
		}
	}
	httpClient = client
	return httpClient
}

func CloneHttpClientWithTimeout(timeout time.Duration) *http.Client {
	base := GetHttpClient()
	clone := *base
	if timeout > 0 {
		clone.Timeout = timeout
	}
	return &clone
}

func ValidateOutboundTarget(ctx context.Context, rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return errors.New("outbound URL is required")
	}
	return common.ValidateOutboundURL(ctx, rawURL, currentOutboundPolicy(), nil)
}

func ValidateExplicitProxy(rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return nil
	}
	_, _, err := validateTrustedProxyURL(rawURL)
	return err
}

func NewSecureWebsocketDialer(proxyURL string) (*websocket.Dialer, error) {
	dialContext, err := common.NewSecureDialContext(currentOutboundPolicy, nil)
	if err != nil {
		return nil, err
	}
	dialer := &websocket.Dialer{
		HandshakeTimeout:  time.Duration(common.OutboundTLSHandshakeTimeoutSeconds) * time.Second,
		NetDialContext:    dialContext,
		EnableCompression: true,
	}
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return dialer, nil
	}
	parsed, _, err := validateTrustedProxyURL(proxyURL)
	if err != nil {
		return nil, err
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		dialer.Proxy = http.ProxyURL(parsed)
	case "socks5", "socks5h":
		dialer.NetDialContext, err = newSecureSOCKS5DialContext(parsed)
		if err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("unsupported trusted proxy scheme")
	}
	return dialer, nil
}

func ApplySecureWebsocketDeadline(conn *websocket.Conn) error {
	if conn == nil {
		return errors.New("nil websocket connection")
	}
	timeout := time.Duration(common.OutboundRequestTimeoutSeconds) * time.Second
	if timeout <= 0 {
		return errors.New("invalid outbound websocket timeout")
	}
	deadline := time.Now().Add(timeout)
	if err := conn.SetReadDeadline(deadline); err != nil {
		return err
	}
	return conn.SetWriteDeadline(deadline)
}

// GetHttpClientWithProxy returns the default client or an explicitly trusted proxy client.
func GetHttpClientWithProxy(proxyURL string) (*http.Client, error) {
	if strings.TrimSpace(proxyURL) == "" {
		return GetHttpClient(), nil
	}
	return NewProxyHttpClient(proxyURL)
}

func ResetProxyClientCache() {
	proxyClientLock.Lock()
	defer proxyClientLock.Unlock()
	for _, client := range proxyClients {
		if client != nil {
			client.CloseIdleConnections()
		}
	}
	proxyClients = make(map[string]*http.Client)
}

func NewProxyHttpClient(proxyURL string) (*http.Client, error) {
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return GetHttpClient(), nil
	}
	parsedURL, canonical, err := validateTrustedProxyURL(proxyURL)
	if err != nil {
		return nil, err
	}

	proxyClientLock.Lock()
	if client, ok := proxyClients[canonical]; ok {
		proxyClientLock.Unlock()
		return client, nil
	}
	proxyClientLock.Unlock()

	config := common.OutboundClientConfig{PolicyProvider: currentOutboundPolicy}
	switch strings.ToLower(parsedURL.Scheme) {
	case "http", "https":
		config.Proxy = http.ProxyURL(parsedURL)
	case "socks5", "socks5h":
		dialContext, err := newSecureSOCKS5DialContext(parsedURL)
		if err != nil {
			return nil, err
		}
		config.DialContext = dialContext
	default:
		return nil, errors.New("unsupported trusted proxy scheme")
	}

	client, err := common.NewSecureHTTPClient(config)
	if err != nil {
		return nil, err
	}
	proxyClientLock.Lock()
	if existing, ok := proxyClients[canonical]; ok {
		proxyClientLock.Unlock()
		client.CloseIdleConnections()
		return existing, nil
	}
	proxyClients[canonical] = client
	proxyClientLock.Unlock()
	return client, nil
}

func validateTrustedProxyURL(raw string) (*url.URL, string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return nil, "", errors.New("invalid proxy URL")
	}
	if parsed.User != nil {
		return nil, "", errors.New("proxy URL credentials are not allowed")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" && scheme != "socks5" && scheme != "socks5h" {
		return nil, "", errors.New("unsupported trusted proxy scheme")
	}
	if err := validateProxyEndpoint(parsed); err != nil {
		return nil, "", err
	}

	canonical := scheme + "://" + strings.ToLower(parsed.Host)
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if environment == "production" || environment == "prod" {
		trusted := false
		for _, candidate := range common.OutboundTrustedProxyURLs {
			candidateURL, parseErr := url.Parse(strings.TrimSpace(candidate))
			if parseErr == nil && candidateURL.User == nil &&
				strings.EqualFold(candidateURL.Scheme, parsed.Scheme) &&
				strings.EqualFold(candidateURL.Host, parsed.Host) {
				trusted = true
				break
			}
		}
		if !trusted {
			return nil, "", errors.New("proxy URL is not in OUTBOUND_TRUSTED_PROXY_URLS")
		}
	}
	return parsed, canonical, nil
}

func validateProxyEndpoint(parsed *url.URL) error {
	policy := currentOutboundPolicy()
	policy.AllowHTTP = true
	policy.AllowedPorts = []int{80, 443, 1080, 8080, 8443}
	syntheticScheme := parsed.Scheme
	if syntheticScheme == "socks5" || syntheticScheme == "socks5h" {
		syntheticScheme = "https"
	}
	return common.ValidateOutboundURL(context.Background(), syntheticScheme+"://"+parsed.Host, policy, nil)
}

func newSecureSOCKS5DialContext(proxyURL *url.URL) (func(context.Context, string, string) (net.Conn, error), error) {
	proxyHost, proxyPort, err := net.SplitHostPort(proxyURL.Host)
	if err != nil {
		proxyHost = proxyURL.Hostname()
		proxyPort = proxyURL.Port()
	}
	if proxyPort == "" {
		proxyPort = "1080"
	}
	proxyIPs, err := net.DefaultResolver.LookupNetIP(context.Background(), "ip", proxyHost)
	if err != nil || len(proxyIPs) == 0 {
		return nil, errors.New("trusted proxy DNS resolution failed")
	}
	policy := currentOutboundPolicy()
	policy.AllowHTTP = true
	policy.AllowedPorts = []int{80, 443, 1080, 8080, 8443}
	var pinnedProxy netip.Addr
	for _, candidate := range proxyIPs {
		candidate = candidate.Unmap()
		target := "https://" + net.JoinHostPort(candidate.String(), proxyPort)
		if err := common.ValidateOutboundURL(context.Background(), target, policy, nil); err != nil {
			return nil, errors.New("trusted proxy resolved to blocked address")
		}
		if !pinnedProxy.IsValid() {
			pinnedProxy = candidate
		}
	}
	if !pinnedProxy.IsValid() {
		return nil, errors.New("trusted proxy has no safe address")
	}

	forward := &net.Dialer{Timeout: policy.ConnectTimeout, KeepAlive: 30 * time.Second}
	socksDialer, err := proxy.SOCKS5(
		"tcp",
		net.JoinHostPort(pinnedProxy.String(), proxyPort),
		nil,
		forward,
	)
	if err != nil {
		return nil, err
	}

	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, errors.New("invalid outbound address")
		}
		currentPolicy := currentOutboundPolicy()
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, errors.New("outbound DNS resolution failed")
		}
		var selected netip.Addr
		for _, ip := range ips {
			ip = ip.Unmap()
			synthetic := "https://" + net.JoinHostPort(ip.String(), port)
			if err := common.ValidateOutboundURL(ctx, synthetic, currentPolicy, nil); err != nil {
				return nil, errors.New("outbound target resolved to blocked address")
			}
			if !selected.IsValid() {
				selected = ip
			}
		}
		if !selected.IsValid() {
			return nil, errors.New("outbound target has no safe address")
		}
		if contextDialer, ok := socksDialer.(proxy.ContextDialer); ok {
			return contextDialer.DialContext(ctx, network, net.JoinHostPort(selected.String(), port))
		}
		type result struct {
			conn net.Conn
			err  error
		}
		done := make(chan result, 1)
		go func() {
			conn, dialErr := socksDialer.Dial(network, net.JoinHostPort(selected.String(), port))
			done <- result{conn: conn, err: dialErr}
		}()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case outcome := <-done:
			return outcome.conn, outcome.err
		}
	}, nil
}

func ParseTrustedProxyPort(raw string) (int, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return 0, err
	}
	port := parsed.Port()
	if port == "" {
		switch parsed.Scheme {
		case "http":
			return 80, nil
		case "https":
			return 443, nil
		case "socks5", "socks5h":
			return 1080, nil
		}
	}
	return strconv.Atoi(port)
}
