package middleware

import (
	"io"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const (
	playgroundChatPath          = "/pg/chat/completions"
	playgroundSessionHeader     = "X-Playground-Session-Id"
	maxPlaygroundSessionIDBytes = 64
)

// PlaygroundPromptCacheKey injects a stable, privacy-preserving cache routing
// key for the cookie-authenticated web playground before channel distribution.
//
// The browser supplies only its opaque conversation id in an internal header.
// We scope that id to the authenticated user and HMAC it with the server secret,
// so raw user/session identifiers never leave AnyRouter. An explicit
// prompt_cache_key in the request body always wins and is never overwritten.
// API-key authenticated /v1 requests (including Codex) do not pass through this
// middleware and keep their client-provided prompt_cache_key unchanged.
func PlaygroundPromptCacheKey() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request == nil || c.Request.URL.Path != playgroundChatPath {
			c.Next()
			return
		}

		sessionID := strings.TrimSpace(c.GetHeader(playgroundSessionHeader))
		// This is an AnyRouter-internal transport header, not an upstream header.
		// Remove it even when no injection happens so wildcard channel header
		// passthrough cannot expose the raw browser conversation id.
		c.Request.Header.Del(playgroundSessionHeader)
		userID := c.GetInt("id")
		if sessionID == "" || len(sessionID) > maxPlaygroundSessionIDBytes || userID <= 0 {
			c.Next()
			return
		}

		storage, err := common.GetBodyStorage(c)
		if err != nil {
			// Distributor owns the public invalid/oversized-body response. Leaving
			// the request untouched here preserves the existing error semantics.
			c.Next()
			return
		}
		body, err := storage.Bytes()
		if err != nil || !gjson.ValidBytes(body) {
			c.Next()
			return
		}
		// Scope the new behavior to the GPT-5.6 family that introduced billed
		// cache writes. Other playground providers can reject unknown OpenAI
		// parameters, so they must keep their existing request shape.
		modelName := strings.ToLower(strings.TrimSpace(gjson.GetBytes(body, "model").String()))
		if !strings.HasPrefix(modelName, "gpt-5.6-") {
			c.Next()
			return
		}
		if gjson.GetBytes(body, "prompt_cache_key").Exists() {
			c.Next()
			return
		}

		cacheKey := common.GenerateHMAC(
			"playground-prompt-cache:v1:" + strconv.Itoa(userID) + ":" + sessionID,
		)
		patched, err := sjson.SetBytes(body, "prompt_cache_key", cacheKey)
		if err != nil {
			c.Next()
			return
		}
		newStorage, err := common.CreateBodyStorage(patched)
		if err != nil {
			c.Next()
			return
		}

		_ = storage.Close()
		c.Set(common.KeyBodyStorage, newStorage)
		c.Request.Body = io.NopCloser(newStorage)
		c.Request.ContentLength = int64(len(patched))
		c.Next()
	}
}
