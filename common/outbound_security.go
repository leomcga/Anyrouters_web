package common

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"golang.org/x/net/idna"
)

var (
	ErrOutboundRequestBlocked = errors.New("outbound request blocked")
	ErrOutboundBodyTooLarge   = errors.New("outbound body exceeds configured limit")
)

type OutboundResolver interface {
	LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error)
}

type netOutboundResolver struct{}

func (netOutboundResolver) LookupNetIP(ctx context.Context, network, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, network, host)
}

type OutboundSecurityPolicy struct {
	AllowHTTP             bool
	AllowPrivateIP        bool
	AllowedPorts          []int
	DomainFilterMode      bool
	DomainList            []string
	IPFilterMode          bool
	IPList                []string
	TrustedDomains        []string
	MaxRedirects          int
	MaxRequestBodyBytes   int64
	MaxResponseBodyBytes  int64
	ConnectTimeout        time.Duration
	TLSHandshakeTimeout   time.Duration
	ResponseHeaderTimeout time.Duration
	IdleConnTimeout       time.Duration
	RequestTimeout        time.Duration
}

type OutboundPolicyProvider func() OutboundSecurityPolicy

type OutboundClientConfig struct {
	PolicyProvider OutboundPolicyProvider
	Resolver       OutboundResolver
	Proxy          func(*http.Request) (*url.URL, error)
	DialContext    func(ctx context.Context, network, address string) (net.Conn, error)
}

type OutboundSecurityError struct {
	Category   string
	HostDigest string
}

func (e *OutboundSecurityError) Error() string {
	if e == nil || e.Category == "" {
		return ErrOutboundRequestBlocked.Error()
	}
	return ErrOutboundRequestBlocked.Error() + ": " + e.Category
}

func (e *OutboundSecurityError) Unwrap() error {
	return ErrOutboundRequestBlocked
}

func OutboundErrorCategory(err error) string {
	var securityErr *OutboundSecurityError
	if errors.As(err, &securityErr) {
		return securityErr.Category
	}
	if errors.Is(err, ErrOutboundBodyTooLarge) {
		return "body_too_large"
	}
	return "transport_error"
}

func OutboundHostDigest(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "invalid"
	}
	host, err := normalizeOutboundHostname(parsed.Hostname())
	if err != nil {
		return "invalid"
	}
	sum := sha256.Sum256([]byte(host))
	return fmt.Sprintf("%x", sum[:6])
}

func NewSecureHTTPClient(config OutboundClientConfig) (*http.Client, error) {
	if config.PolicyProvider == nil {
		return nil, errors.New("outbound policy provider is required")
	}
	if config.Resolver == nil {
		config.Resolver = netOutboundResolver{}
	}

	policy := normalizeOutboundPolicy(config.PolicyProvider())
	dialer := &secureOutboundDialer{
		resolver:       config.Resolver,
		policyProvider: config.PolicyProvider,
	}
	transport := &http.Transport{
		Proxy:                 config.Proxy,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          RelayMaxIdleConns,
		MaxIdleConnsPerHost:   RelayMaxIdleConnsPerHost,
		IdleConnTimeout:       policy.IdleConnTimeout,
		TLSHandshakeTimeout:   policy.TLSHandshakeTimeout,
		ResponseHeaderTimeout: policy.ResponseHeaderTimeout,
		ExpectContinueTimeout: time.Second,
	}
	if config.DialContext != nil {
		transport.DialContext = config.DialContext
	}
	if TLSInsecureSkipVerify {
		transport.TLSClientConfig = InsecureTLSConfig
	}

	roundTripper := &secureOutboundRoundTripper{
		base:           transport,
		policyProvider: config.PolicyProvider,
		resolver:       config.Resolver,
	}
	client := &http.Client{
		Transport: roundTripper,
		Timeout:   policy.RequestTimeout,
	}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		currentPolicy := normalizeOutboundPolicy(config.PolicyProvider())
		if len(via) >= currentPolicy.MaxRedirects {
			return &OutboundSecurityError{
				Category:   "too_many_redirects",
				HostDigest: OutboundHostDigest(req.URL.String()),
			}
		}
		if _, err := validateOutboundURL(req.Context(), req.URL, currentPolicy, config.Resolver, true); err != nil {
			return err
		}
		if len(via) > 0 && !sameOutboundOrigin(via[len(via)-1].URL, req.URL) {
			req.Header.Del("Authorization")
			req.Header.Del("Cookie")
			req.Header.Del("Proxy-Authorization")
			req.Header.Del("X-API-Key")
			req.Header.Del("X-Goog-API-Key")
		}
		return nil
	}
	return client, nil
}

func NewSecureDialContext(policyProvider OutboundPolicyProvider, resolver OutboundResolver) (func(context.Context, string, string) (net.Conn, error), error) {
	if policyProvider == nil {
		return nil, errors.New("outbound policy provider is required")
	}
	if resolver == nil {
		resolver = netOutboundResolver{}
	}
	dialer := &secureOutboundDialer{
		resolver:       resolver,
		policyProvider: policyProvider,
	}
	return dialer.DialContext, nil
}

func ValidateOutboundURL(ctx context.Context, rawURL string, policy OutboundSecurityPolicy, resolver OutboundResolver) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return outboundSecurityError("invalid_url", rawURL)
	}
	if resolver == nil {
		resolver = netOutboundResolver{}
	}
	_, err = validateOutboundURL(ctx, parsed, normalizeOutboundPolicy(policy), resolver, true)
	return err
}

func ParseOutboundPortRanges(portConfigs []string) ([]int, error) {
	return parsePortRanges(portConfigs)
}

type secureOutboundRoundTripper struct {
	base           http.RoundTripper
	policyProvider OutboundPolicyProvider
	resolver       OutboundResolver
}

func (t *secureOutboundRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil || req.URL == nil {
		return nil, outboundSecurityError("invalid_request", "")
	}
	policy := normalizeOutboundPolicy(t.policyProvider())
	if req.Host != "" && !equalOutboundHost(req.Host, req.URL.Host) {
		return nil, outboundSecurityError("custom_host", req.URL.String())
	}
	if _, err := validateOutboundURL(req.Context(), req.URL, policy, t.resolver, true); err != nil {
		return nil, err
	}
	if err := limitOutboundRequestBody(req, policy.MaxRequestBodyBytes); err != nil {
		return nil, err
	}

	resp, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	if resp != nil && resp.Body != nil && policy.MaxResponseBodyBytes > 0 {
		resp.Body = newLimitedOutboundReadCloser(resp.Body, policy.MaxResponseBodyBytes)
	}
	return resp, nil
}

type secureOutboundDialer struct {
	resolver       OutboundResolver
	policyProvider OutboundPolicyProvider
}

func (d *secureOutboundDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, outboundSecurityError("invalid_dial_address", "http://"+address)
	}
	policy := normalizeOutboundPolicy(d.policyProvider())
	portNumber, err := strconv.Atoi(port)
	if err != nil || !isOutboundPortAllowed(portNumber, policy.AllowedPorts) {
		return nil, outboundSecurityError("port_not_allowed", "http://"+address)
	}

	normalizedHost, err := normalizeOutboundHostname(host)
	if err != nil {
		return nil, outboundSecurityError("invalid_host", "http://"+address)
	}
	addresses, err := resolveOutboundHost(ctx, normalizedHost, policy, d.resolver)
	if err != nil {
		return nil, err
	}

	netDialer := &net.Dialer{
		Timeout:   policy.ConnectTimeout,
		KeepAlive: 30 * time.Second,
	}
	var lastErr error
	for _, ip := range addresses {
		conn, dialErr := netDialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = errors.New("no safe address available")
	}
	return nil, lastErr
}

func validateOutboundURL(ctx context.Context, parsed *url.URL, policy OutboundSecurityPolicy, resolver OutboundResolver, resolve bool) ([]netip.Addr, error) {
	if parsed == nil || parsed.Host == "" {
		return nil, outboundSecurityError("missing_host", "")
	}
	scheme := strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if scheme != "https" && (scheme != "http" || !policy.AllowHTTP) {
		return nil, outboundSecurityError("scheme_not_allowed", parsed.String())
	}
	if parsed.User != nil {
		return nil, outboundSecurityError("userinfo_not_allowed", parsed.String())
	}
	if parsed.Opaque != "" {
		return nil, outboundSecurityError("opaque_url_not_allowed", parsed.String())
	}

	host, err := normalizeOutboundHostname(parsed.Hostname())
	if err != nil {
		return nil, outboundSecurityError("invalid_host", parsed.String())
	}
	if isBlockedOutboundHostname(host) {
		return nil, outboundSecurityError("internal_hostname", parsed.String())
	}
	if !isOutboundDomainAllowed(host, policy) {
		return nil, outboundSecurityError("domain_not_allowed", parsed.String())
	}

	port, err := outboundURLPort(parsed)
	if err != nil || !isOutboundPortAllowed(port, policy.AllowedPorts) {
		return nil, outboundSecurityError("port_not_allowed", parsed.String())
	}
	if !resolve {
		return nil, nil
	}
	return resolveOutboundHost(ctx, host, policy, resolver)
}

func resolveOutboundHost(ctx context.Context, host string, policy OutboundSecurityPolicy, resolver OutboundResolver) ([]netip.Addr, error) {
	if ip, ok := parseOutboundIP(host); ok {
		if err := validateOutboundIP(ip, policy); err != nil {
			return nil, err
		}
		return []netip.Addr{ip}, nil
	}
	if !strings.Contains(host, ".") {
		return nil, outboundSecurityError("single_label_hostname", "https://"+host)
	}

	addresses, err := resolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		return nil, outboundSecurityError("dns_resolution_failed", "https://"+host)
	}
	safeAddresses := make([]netip.Addr, 0, len(addresses))
	for _, address := range addresses {
		address = address.Unmap()
		if err := validateOutboundIP(address, policy); err != nil {
			return nil, outboundSecurityError("dns_resolved_to_blocked_ip", "https://"+host)
		}
		safeAddresses = append(safeAddresses, address)
	}
	return safeAddresses, nil
}

func validateOutboundIP(ip netip.Addr, policy OutboundSecurityPolicy) error {
	ip = ip.Unmap()
	if !ip.IsValid() {
		return outboundSecurityError("invalid_ip", "")
	}
	if !policy.AllowPrivateIP && isBlockedOutboundIP(ip) {
		return outboundSecurityError("private_or_special_ip", "https://"+ip.String())
	}
	listed := IsIpInCIDRList(net.IP(ip.AsSlice()), policy.IPList)
	if policy.IPFilterMode && !listed {
		return outboundSecurityError("ip_not_allowed", "https://"+ip.String())
	}
	if !policy.IPFilterMode && listed {
		return outboundSecurityError("ip_denied", "https://"+ip.String())
	}
	return nil
}

func isBlockedOutboundIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	if ip.Is4() {
		value := ip.As4()
		switch {
		case value[0] == 0:
			return true
		case value[0] == 100 && value[1]&0xc0 == 64:
			return true
		case value[0] == 192 && value[1] == 0 && value[2] == 0:
			return true
		case value[0] == 198 && (value[1] == 18 || value[1] == 19):
			return true
		case value[0] >= 224:
			return true
		}
		return !ip.IsGlobalUnicast()
	}
	return !ip.IsGlobalUnicast()
}

func parseOutboundIP(host string) (netip.Addr, bool) {
	trimmed := strings.Trim(strings.TrimSpace(host), "[]")
	if parsed, err := netip.ParseAddr(trimmed); err == nil {
		return parsed.Unmap(), true
	}
	if strings.Contains(trimmed, ":") {
		return netip.Addr{}, false
	}
	value, ok := parseLegacyIPv4(trimmed)
	if !ok {
		return netip.Addr{}, false
	}
	return netip.AddrFrom4([4]byte{byte(value >> 24), byte(value >> 16), byte(value >> 8), byte(value)}), true
}

func parseLegacyIPv4(host string) (uint32, bool) {
	parts := strings.Split(host, ".")
	if len(parts) == 0 || len(parts) > 4 {
		return 0, false
	}
	values := make([]uint64, len(parts))
	for index, part := range parts {
		if part == "" {
			return 0, false
		}
		value, err := parseLegacyIPv4Part(part)
		if err != nil {
			return 0, false
		}
		values[index] = value
	}
	switch len(values) {
	case 1:
		if values[0] > 0xffffffff {
			return 0, false
		}
		return uint32(values[0]), true
	case 2:
		if values[0] > 0xff || values[1] > 0xffffff {
			return 0, false
		}
		return uint32(values[0]<<24 | values[1]), true
	case 3:
		if values[0] > 0xff || values[1] > 0xff || values[2] > 0xffff {
			return 0, false
		}
		return uint32(values[0]<<24 | values[1]<<16 | values[2]), true
	case 4:
		for _, value := range values {
			if value > 0xff {
				return 0, false
			}
		}
		return uint32(values[0]<<24 | values[1]<<16 | values[2]<<8 | values[3]), true
	default:
		return 0, false
	}
}

func parseLegacyIPv4Part(part string) (uint64, error) {
	base := 10
	value := part
	if len(part) > 2 && (strings.HasPrefix(part, "0x") || strings.HasPrefix(part, "0X")) {
		base = 16
		value = part[2:]
	} else if len(part) > 1 && part[0] == '0' {
		base = 8
		value = part[1:]
	}
	if value == "" {
		value = "0"
	}
	return strconv.ParseUint(value, base, 32)
}

func normalizeOutboundHostname(host string) (string, error) {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if host == "" || strings.ContainsAny(host, " \t\r\n/%\\") {
		return "", errors.New("invalid hostname")
	}
	if ip, ok := parseOutboundIP(host); ok {
		return ip.String(), nil
	}
	if looksLikeLegacyIPv4(host) {
		return "", errors.New("invalid numeric hostname")
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil || ascii == "" {
		return "", errors.New("invalid hostname")
	}
	return strings.ToLower(strings.TrimSuffix(ascii, ".")), nil
}

func looksLikeLegacyIPv4(host string) bool {
	if host == "" {
		return false
	}
	hasDigit := false
	for _, r := range host {
		if r >= '0' && r <= '9' {
			hasDigit = true
			continue
		}
		if r == '.' || r == 'x' || r == 'X' ||
			(r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			continue
		}
		return false
	}
	return hasDigit
}

func isBlockedOutboundHostname(host string) bool {
	blockedExact := map[string]struct{}{
		"localhost":                  {},
		"localhost.localdomain":      {},
		"metadata":                   {},
		"metadata.google.internal":   {},
		"metadata.google.internal.":  {},
		"instance-data":              {},
		"instance-data.ec2.internal": {},
	}
	if _, blocked := blockedExact[host]; blocked {
		return true
	}
	for _, suffix := range []string{".localhost", ".local", ".internal", ".localdomain", ".lan", ".home", ".corp"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func isOutboundDomainAllowed(host string, policy OutboundSecurityPolicy) bool {
	if _, ok := parseOutboundIP(host); ok {
		return true
	}
	if len(policy.TrustedDomains) > 0 && !matchOutboundDomainList(host, policy.TrustedDomains) {
		return false
	}
	listed := matchOutboundDomainList(host, policy.DomainList)
	if policy.DomainFilterMode {
		return listed
	}
	if !policy.DomainFilterMode && listed {
		return false
	}
	return true
}

func matchOutboundDomainList(host string, list []string) bool {
	for _, rawPattern := range list {
		pattern := strings.TrimSpace(strings.ToLower(rawPattern))
		if pattern == "" {
			continue
		}
		includeSubdomains := strings.HasPrefix(pattern, "*.")
		pattern = strings.TrimPrefix(pattern, "*.")
		normalized, err := normalizeOutboundHostname(pattern)
		if err != nil {
			continue
		}
		if host == normalized {
			return true
		}
		if includeSubdomains && strings.HasSuffix(host, "."+normalized) {
			return true
		}
	}
	return false
}

func outboundURLPort(parsed *url.URL) (int, error) {
	if parsed.Port() != "" {
		return strconv.Atoi(parsed.Port())
	}
	switch strings.ToLower(parsed.Scheme) {
	case "https":
		return 443, nil
	case "http":
		return 80, nil
	default:
		return 0, errors.New("unsupported scheme")
	}
}

func isOutboundPortAllowed(port int, allowed []int) bool {
	if port < 1 || port > 65535 {
		return false
	}
	if len(allowed) == 0 {
		return port == 80 || port == 443
	}
	for _, candidate := range allowed {
		if candidate == port {
			return true
		}
	}
	return false
}

func normalizeOutboundPolicy(policy OutboundSecurityPolicy) OutboundSecurityPolicy {
	if policy.MaxRedirects <= 0 {
		policy.MaxRedirects = 3
	}
	if policy.MaxRequestBodyBytes <= 0 {
		policy.MaxRequestBodyBytes = 64 << 20
	}
	if policy.MaxResponseBodyBytes <= 0 {
		policy.MaxResponseBodyBytes = 128 << 20
	}
	if policy.ConnectTimeout <= 0 {
		policy.ConnectTimeout = 10 * time.Second
	}
	if policy.TLSHandshakeTimeout <= 0 {
		policy.TLSHandshakeTimeout = 10 * time.Second
	}
	if policy.ResponseHeaderTimeout <= 0 {
		policy.ResponseHeaderTimeout = 30 * time.Second
	}
	if policy.IdleConnTimeout <= 0 {
		policy.IdleConnTimeout = 90 * time.Second
	}
	if policy.RequestTimeout <= 0 {
		policy.RequestTimeout = 10 * time.Minute
	}
	if len(policy.AllowedPorts) == 0 {
		policy.AllowedPorts = []int{80, 443}
	}
	return policy
}

func outboundSecurityError(category string, rawURL string) error {
	return &OutboundSecurityError{
		Category:   category,
		HostDigest: OutboundHostDigest(rawURL),
	}
}

func sameOutboundOrigin(left, right *url.URL) bool {
	if left == nil || right == nil {
		return false
	}
	return strings.EqualFold(left.Scheme, right.Scheme) && equalOutboundHost(left.Host, right.Host)
}

func equalOutboundHost(left, right string) bool {
	leftHost, leftPort, leftErr := net.SplitHostPort(left)
	if leftErr != nil {
		leftHost = left
		leftPort = ""
	}
	rightHost, rightPort, rightErr := net.SplitHostPort(right)
	if rightErr != nil {
		rightHost = right
		rightPort = ""
	}
	normalizedLeft, leftErr := normalizeOutboundHostname(leftHost)
	normalizedRight, rightErr := normalizeOutboundHostname(rightHost)
	return leftErr == nil && rightErr == nil && normalizedLeft == normalizedRight && leftPort == rightPort
}

func limitOutboundRequestBody(req *http.Request, maxBytes int64) error {
	if req == nil || req.Body == nil || maxBytes <= 0 {
		return nil
	}
	if req.ContentLength > maxBytes {
		return ErrOutboundBodyTooLarge
	}
	req.Body = newLimitedOutboundReadCloser(req.Body, maxBytes)
	return nil
}

type limitedOutboundReadCloser struct {
	reader    io.ReadCloser
	remaining int64
	exceeded  atomic.Bool
}

func newLimitedOutboundReadCloser(reader io.ReadCloser, maxBytes int64) io.ReadCloser {
	return &limitedOutboundReadCloser{reader: reader, remaining: maxBytes}
}

func (r *limitedOutboundReadCloser) Read(buffer []byte) (int, error) {
	if r.exceeded.Load() {
		return 0, ErrOutboundBodyTooLarge
	}
	if r.remaining == 0 {
		var probe [1]byte
		count, err := r.reader.Read(probe[:])
		if count > 0 {
			r.exceeded.Store(true)
			return 0, ErrOutboundBodyTooLarge
		}
		return 0, err
	}
	if int64(len(buffer)) > r.remaining {
		buffer = buffer[:r.remaining]
	}
	count, err := r.reader.Read(buffer)
	r.remaining -= int64(count)
	return count, err
}

func (r *limitedOutboundReadCloser) Close() error {
	return r.reader.Close()
}
