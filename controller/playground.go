package controller

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAI, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, types.RelayFormatOpenAI)
}

// PlaygroundImage is the playground's image-generation entry point. The console
// authenticates with a session cookie (UserAuth), whereas /v1/images/generations
// requires an API key (TokenAuth) — so image models that can ONLY be driven via
// the dedicated images endpoint (e.g. gpt-image-2, which rejects chat/completions)
// need their own cookie-authenticated relay route. This mirrors Playground above
// but dispatches the OpenAI image format, reusing the full billing + channel
// distribution pipeline (Relay keys off the relay format, not the URL path).
func PlaygroundImage(c *gin.Context) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, types.RelayFormatOpenAIImage)
}

// setupPlaygroundTaskContext mirrors PlaygroundImage's cookie→temp-token wiring
// for the async video task pipeline: it rejects access tokens, writes the user
// cache (so acceptUnsetRatio is set) and installs a temp token in the
// playground group so billing/quota run exactly like an API-key request.
// Returns false (and writes the error) if context setup fails.
func setupPlaygroundTaskContext(c *gin.Context) bool {
	if c.GetBool("use_access_token") {
		c.JSON(http.StatusBadRequest, &dto.TaskError{
			Code:       "access_denied",
			Message:    "暂不支持使用 access token",
			StatusCode: http.StatusBadRequest,
		})
		return false
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return false
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "get_user_cache_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return false
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)
	return true
}

// PlaygroundVideo is the playground's video-generation entry point (Veo). Video
// uses the async task pipeline (submit → poll), so it cannot reuse Relay() like
// PlaygroundImage; it delegates to the same RelayTask the API-key route uses,
// after installing the cookie-based temp-token context.
func PlaygroundVideo(c *gin.Context) {
	if !setupPlaygroundTaskContext(c) {
		return
	}
	RelayTask(c)
}

// PlaygroundVideoFetch polls a playground-submitted video task by id (cookie
// auth). Mirrors RelayTaskFetch.
func PlaygroundVideoFetch(c *gin.Context) {
	if !setupPlaygroundTaskContext(c) {
		return
	}
	RelayTaskFetch(c)
}
