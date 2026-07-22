package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func runPlaygroundPromptCacheMiddleware(t *testing.T, userID int, sessionID, body string) (string, string) {
	t.Helper()

	var promptCacheKey string
	var forwardedSessionHeader string
	router := gin.New()
	router.Use(BodyStorageCleanup())
	router.Use(func(c *gin.Context) {
		c.Set("id", userID)
		c.Next()
	})
	router.Use(PlaygroundPromptCacheKey())
	router.POST(playgroundChatPath, func(c *gin.Context) {
		var payload map[string]any
		require.NoError(t, common.UnmarshalBodyReusable(c, &payload))
		promptCacheKey, _ = payload["prompt_cache_key"].(string)
		forwardedSessionHeader = c.GetHeader(playgroundSessionHeader)
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, playgroundChatPath, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sessionID != "" {
		req.Header.Set(playgroundSessionHeader, sessionID)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	require.Equal(t, http.StatusNoContent, recorder.Code)
	return promptCacheKey, forwardedSessionHeader
}

func TestPlaygroundPromptCacheKeyIsStableScopedAndPrivate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldSecret := common.CryptoSecret
	common.CryptoSecret = "playground-prompt-cache-test-secret"
	t.Cleanup(func() { common.CryptoSecret = oldSecret })

	first, header := runPlaygroundPromptCacheMiddleware(t, 42, "session-123", `{"model":"gpt-5.6-sol"}`)
	second, _ := runPlaygroundPromptCacheMiddleware(t, 42, "session-123", `{"model":"gpt-5.6-sol","messages":[]}`)
	otherUser, _ := runPlaygroundPromptCacheMiddleware(t, 43, "session-123", `{"model":"gpt-5.6-sol"}`)
	otherSession, _ := runPlaygroundPromptCacheMiddleware(t, 42, "session-456", `{"model":"gpt-5.6-sol"}`)

	require.Len(t, first, 64)
	require.Equal(t, first, second)
	require.NotEqual(t, first, otherUser)
	require.NotEqual(t, first, otherSession)
	require.NotContains(t, first, "42")
	require.NotContains(t, first, "session-123")
	require.Empty(t, header, "internal session header must never be forwarded")
}

func TestPlaygroundPromptCacheKeyPreservesExplicitClientValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key, header := runPlaygroundPromptCacheMiddleware(
		t,
		42,
		"session-123",
		`{"model":"gpt-5.6-sol","prompt_cache_key":"client-owned-key"}`,
	)

	require.Equal(t, "client-owned-key", key)
	require.Empty(t, header)
}

func TestPlaygroundPromptCacheKeySkipsMissingOrInvalidSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	withoutSession, _ := runPlaygroundPromptCacheMiddleware(t, 42, "", `{"model":"gpt-5.6-sol"}`)
	tooLong, _ := runPlaygroundPromptCacheMiddleware(t, 42, strings.Repeat("x", maxPlaygroundSessionIDBytes+1), `{"model":"gpt-5.6-sol"}`)
	withoutUser, _ := runPlaygroundPromptCacheMiddleware(t, 0, "session-123", `{"model":"gpt-5.6-sol"}`)

	require.Empty(t, withoutSession)
	require.Empty(t, tooLong)
	require.Empty(t, withoutUser)
}

func TestPlaygroundPromptCacheKeyDoesNotChangeOtherModels(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key, header := runPlaygroundPromptCacheMiddleware(t, 42, "session-123", `{"model":"claude-opus-4-8"}`)

	require.Empty(t, key)
	require.Empty(t, header)
}
