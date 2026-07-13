package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRateLimitResponseIncludesRetryAfter(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	rejectRateLimited(ctx, 17)
	require.Equal(t, http.StatusTooManyRequests, ctx.Writer.Status())
	require.Equal(t, "17", recorder.Header().Get("Retry-After"))
	require.True(t, ctx.IsAborted())
}
