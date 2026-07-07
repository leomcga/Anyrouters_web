package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseVideoRange(t *testing.T) {
	tests := []struct {
		name      string
		header    string
		size      int64
		wantStart int64
		wantEnd   int64
		wantOK    bool
	}{
		{
			name:      "open ended",
			header:    "bytes=0-",
			size:      100,
			wantStart: 0,
			wantEnd:   99,
			wantOK:    true,
		},
		{
			name:      "bounded",
			header:    "bytes=10-19",
			size:      100,
			wantStart: 10,
			wantEnd:   19,
			wantOK:    true,
		},
		{
			name:      "clamps end",
			header:    "bytes=90-999",
			size:      100,
			wantStart: 90,
			wantEnd:   99,
			wantOK:    true,
		},
		{
			name:      "suffix",
			header:    "bytes=-20",
			size:      100,
			wantStart: 80,
			wantEnd:   99,
			wantOK:    true,
		},
		{
			name:      "large suffix returns whole file",
			header:    "bytes=-200",
			size:      100,
			wantStart: 0,
			wantEnd:   99,
			wantOK:    true,
		},
		{
			name:   "start outside file",
			header: "bytes=100-",
			size:   100,
			wantOK: false,
		},
		{
			name:   "multi range unsupported",
			header: "bytes=0-1,3-4",
			size:   100,
			wantOK: false,
		},
		{
			name:   "invalid unit",
			header: "items=0-1",
			size:   100,
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			start, end, ok := parseVideoRange(tt.header, tt.size)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if start != tt.wantStart || end != tt.wantEnd {
				t.Fatalf("range = %d-%d, want %d-%d", start, end, tt.wantStart, tt.wantEnd)
			}
		})
	}
}

func TestWriteVideoDataURLSupportsRange(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodGet, "/v1/videos/task/content", nil)
	req.Header.Set("Range", "bytes=2-5")
	ctx.Request = req

	err := writeVideoDataURL(ctx, "data:video/mp4;base64,MDEyMzQ1Njc4OQ==")
	if err != nil {
		t.Fatalf("writeVideoDataURL returned error: %v", err)
	}

	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusPartialContent)
	}
	if got := recorder.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want bytes", got)
	}
	if got := recorder.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Fatalf("Content-Range = %q, want bytes 2-5/10", got)
	}
	if got := recorder.Body.String(); got != "2345" {
		t.Fatalf("body = %q, want 2345", got)
	}
}
