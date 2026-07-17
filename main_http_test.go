package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/net/http2"
)

func TestHTTPHandlerKeepsHTTP1Compatibility(t *testing.T) {
	handler := newHTTPHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, streamingSupported := w.(http.Flusher)
		fmt.Fprintf(w, "%s %t", r.Proto, streamingSupported)
	}))
	server := httptest.NewServer(handler)
	defer server.Close()

	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatalf("HTTP/1 request failed: %v", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read HTTP/1 response: %v", err)
	}
	if got, want := string(body), "HTTP/1.1 true"; got != want {
		t.Fatalf("protocol = %q, want %q", got, want)
	}
}

func TestHTTPHandlerAcceptsLargeH2CRequest(t *testing.T) {
	const bodySize = 33 * 1024 * 1024

	handler := newHTTPHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n, err := io.Copy(io.Discard, r.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
			return
		}
		_, streamingSupported := w.(http.Flusher)
		fmt.Fprintf(w, "%s %d %t", r.Proto, n, streamingSupported)
	}))
	server := httptest.NewServer(handler)
	defer server.Close()

	transport := &http2.Transport{
		AllowHTTP: true,
		DialTLSContext: func(ctx context.Context, network, address string, _ *tls.Config) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, address)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}

	request, err := http.NewRequest(http.MethodPost, server.URL, io.LimitReader(zeroReader{}, bodySize))
	if err != nil {
		t.Fatalf("create h2c request: %v", err)
	}
	request.ContentLength = bodySize

	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("h2c request failed: %v", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read h2c response: %v", err)
	}
	if got, want := string(body), "HTTP/2.0 34603008 true"; got != want {
		t.Fatalf("response = %q, want %q", got, want)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}
