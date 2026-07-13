package common

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type staticOutboundResolver map[string][]netip.Addr

func (r staticOutboundResolver) LookupNetIP(_ context.Context, _ string, host string) ([]netip.Addr, error) {
	addresses, ok := r[host]
	if !ok {
		return nil, errors.New("not found")
	}
	return append([]netip.Addr(nil), addresses...), nil
}

type sequenceOutboundResolver struct {
	mu        sync.Mutex
	responses [][]netip.Addr
}

func (r *sequenceOutboundResolver) LookupNetIP(_ context.Context, _ string, _ string) ([]netip.Addr, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.responses) == 0 {
		return nil, errors.New("no response")
	}
	response := r.responses[0]
	r.responses = r.responses[1:]
	return append([]netip.Addr(nil), response...), nil
}

type blockingOutboundResolver struct{}

func (blockingOutboundResolver) LookupNetIP(ctx context.Context, _ string, _ string) ([]netip.Addr, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func secureTestPolicy() OutboundSecurityPolicy {
	return OutboundSecurityPolicy{
		AllowHTTP:            true,
		AllowedPorts:         []int{80, 443, 8080},
		MaxRedirects:         2,
		MaxRequestBodyBytes:  16,
		MaxResponseBodyBytes: 16,
		RequestTimeout:       time.Second,
	}
}

func TestOutboundSecurityRejectsPrivateAndObfuscatedAddresses(t *testing.T) {
	t.Parallel()
	policy := secureTestPolicy()
	testCases := []string{
		"http://localhost",
		"http://localhost.",
		"http://sub.localhost",
		"http://127.0.0.1",
		"http://127.1",
		"http://2130706433",
		"http://0x7f000001",
		"http://017700000001",
		"http://0177.0.0.1",
		"http://169.254.169.254",
		"http://10.0.0.1",
		"http://172.16.0.1",
		"http://192.168.0.1",
		"http://[::1]",
		"http://[fc00::1]",
		"http://[::ffff:127.0.0.1]",
		"http://metadata.google.internal",
		"file:///etc/passwd",
		"gopher://example.com",
		"http://user:password@example.com",
	}
	for _, testURL := range testCases {
		testURL := testURL
		t.Run(testURL, func(t *testing.T) {
			err := ValidateOutboundURL(context.Background(), testURL, policy, staticOutboundResolver{})
			require.Error(t, err)
			require.ErrorIs(t, err, ErrOutboundRequestBlocked)
			require.NotContains(t, err.Error(), testURL)
			require.NotContains(t, err.Error(), "169.254.169.254")
		})
	}
}

func TestOutboundSecurityRejectsDomainResolvingToPrivateOrMixedAddresses(t *testing.T) {
	t.Parallel()
	policy := secureTestPolicy()
	resolver := staticOutboundResolver{
		"private.example": {netip.MustParseAddr("10.1.2.3")},
		"mixed.example": {
			netip.MustParseAddr("93.184.216.34"),
			netip.MustParseAddr("192.168.1.2"),
		},
	}
	for _, testURL := range []string{"https://private.example", "https://mixed.example"} {
		err := ValidateOutboundURL(context.Background(), testURL, policy, resolver)
		require.Error(t, err)
		require.Equal(t, "dns_resolved_to_blocked_ip", OutboundErrorCategory(err))
	}
}

func TestOutboundSecurityAllowsPublicHTTPSAndExactDomainPatterns(t *testing.T) {
	t.Parallel()
	policy := secureTestPolicy()
	policy.AllowHTTP = false
	policy.TrustedDomains = []string{"api.example.com", "*.trusted.example"}
	resolver := staticOutboundResolver{
		"api.example.com":      {netip.MustParseAddr("93.184.216.34")},
		"sub.trusted.example":  {netip.MustParseAddr("93.184.216.35")},
		"evilapi.example.com":  {netip.MustParseAddr("93.184.216.36")},
		"trusted.example.evil": {netip.MustParseAddr("93.184.216.37")},
	}
	require.NoError(t, ValidateOutboundURL(context.Background(), "https://api.example.com/path", policy, resolver))
	require.NoError(t, ValidateOutboundURL(context.Background(), "https://sub.trusted.example/path", policy, resolver))
	require.Error(t, ValidateOutboundURL(context.Background(), "https://evilapi.example.com", policy, resolver))
	require.Error(t, ValidateOutboundURL(context.Background(), "https://trusted.example.evil", policy, resolver))
	require.Error(t, ValidateOutboundURL(context.Background(), "http://api.example.com", policy, resolver))
}

func TestSecureClientBlocksDNSRebindingAtDialTime(t *testing.T) {
	t.Parallel()
	resolver := &sequenceOutboundResolver{responses: [][]netip.Addr{
		{netip.MustParseAddr("93.184.216.34")},
		{netip.MustParseAddr("127.0.0.1")},
	}}
	client, err := NewSecureHTTPClient(OutboundClientConfig{
		PolicyProvider: func() OutboundSecurityPolicy { return secureTestPolicy() },
		Resolver:       resolver,
	})
	require.NoError(t, err)

	req, err := http.NewRequest(http.MethodGet, "http://rebind.example", nil)
	require.NoError(t, err)
	_, err = client.Do(req)
	require.Error(t, err)
	require.Equal(t, "dns_resolved_to_blocked_ip", OutboundErrorCategory(err))
}

func TestSecureClientRedirectRevalidationBlocksPrivateTarget(t *testing.T) {
	t.Parallel()
	client, err := NewSecureHTTPClient(OutboundClientConfig{
		PolicyProvider: func() OutboundSecurityPolicy { return secureTestPolicy() },
		Resolver: staticOutboundResolver{
			"public.example": {netip.MustParseAddr("93.184.216.34")},
		},
	})
	require.NoError(t, err)
	previous := httptest.NewRequest(http.MethodGet, "https://public.example/start", nil)
	redirect := httptest.NewRequest(http.MethodGet, "http://169.254.169.254/latest/meta-data", nil)
	err = client.CheckRedirect(redirect, []*http.Request{previous})
	require.Error(t, err)
	require.ErrorIs(t, err, ErrOutboundRequestBlocked)

	second := httptest.NewRequest(http.MethodGet, "https://public.example/second", nil)
	third := httptest.NewRequest(http.MethodGet, "https://public.example/third", nil)
	err = client.CheckRedirect(third, []*http.Request{previous, second})
	require.Error(t, err)
	require.Equal(t, "too_many_redirects", OutboundErrorCategory(err))
}

func TestSecureClientRejectsCustomHostHeader(t *testing.T) {
	t.Parallel()
	client, err := NewSecureHTTPClient(OutboundClientConfig{
		PolicyProvider: func() OutboundSecurityPolicy { return secureTestPolicy() },
		Resolver: staticOutboundResolver{
			"public.example": {netip.MustParseAddr("93.184.216.34")},
		},
	})
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodGet, "https://public.example", nil)
	require.NoError(t, err)
	req.Host = "169.254.169.254"
	_, err = client.Do(req)
	require.Error(t, err)
	require.Equal(t, "custom_host", OutboundErrorCategory(err))
}

func TestSecureClientEnforcesResponseLimitAndTimeout(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", 32))
	}))
	defer server.Close()
	serverURL, err := url.Parse(server.URL)
	require.NoError(t, err)
	dialer := &net.Dialer{}

	client, err := NewSecureHTTPClient(OutboundClientConfig{
		PolicyProvider: func() OutboundSecurityPolicy { return secureTestPolicy() },
		Resolver: staticOutboundResolver{
			"public.example": {netip.MustParseAddr("93.184.216.34")},
		},
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, serverURL.Host)
		},
	})
	require.NoError(t, err)
	resp, err := client.Get("http://public.example")
	require.NoError(t, err)
	defer resp.Body.Close()
	_, err = io.ReadAll(resp.Body)
	require.ErrorIs(t, err, ErrOutboundBodyTooLarge)

	timeoutPolicy := secureTestPolicy()
	timeoutPolicy.RequestTimeout = 30 * time.Millisecond
	timeoutClient, err := NewSecureHTTPClient(OutboundClientConfig{
		PolicyProvider: func() OutboundSecurityPolicy { return timeoutPolicy },
		Resolver:       blockingOutboundResolver{},
	})
	require.NoError(t, err)
	started := time.Now()
	_, err = timeoutClient.Get("https://timeout.example")
	require.Error(t, err)
	require.Less(t, time.Since(started), 500*time.Millisecond)
}
