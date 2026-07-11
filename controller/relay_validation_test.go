package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRelayValidationErrorsReturnBadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name   string
		path   string
		format types.RelayFormat
		body   string
	}{
		{
			name:   "oversized image count",
			path:   "/v1/images/generations",
			format: types.RelayFormatOpenAIImage,
			body:   `{"model":"gpt-image-2","prompt":"validation only","n":1000000000}`,
		},
		{
			name:   "oversized max tokens",
			path:   "/v1/chat/completions",
			format: types.RelayFormatOpenAI,
			body:   `{"model":"gpt-5.6-luna","messages":[{"role":"user","content":"validation only"}],"max_tokens":4294967295}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, tt.path, bytes.NewBufferString(tt.body))
			ctx.Request.Header.Set("Content-Type", "application/json")

			Relay(ctx, tt.format)

			require.Equal(t, http.StatusBadRequest, recorder.Code)
			require.Contains(t, recorder.Body.String(), `"code":"invalid_request"`)
		})
	}
}
