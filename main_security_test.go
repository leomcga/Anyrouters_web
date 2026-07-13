package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestProductionSessionCookieOptions(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	options := sessionCookieOptions()
	require.True(t, options.Secure)
	require.True(t, options.HttpOnly)
	require.Equal(t, "/", options.Path)
	require.Equal(t, http.SameSiteStrictMode, options.SameSite)
	require.Greater(t, options.MaxAge, 0)
}

func TestDevelopmentSessionCookieAllowsHTTP(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	require.False(t, sessionCookieOptions().Secure)
}

func TestProductionSessionCookieHeader(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	store := cookie.NewStore([]byte(strings.Repeat("s", 32)))
	store.Options(sessionCookieOptions())
	engine := gin.New()
	engine.Use(sessions.Sessions("session", store))
	engine.GET("/", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 1)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	engine.ServeHTTP(recorder, request)
	setCookie := recorder.Header().Get("Set-Cookie")
	require.Contains(t, setCookie, "Secure")
	require.Contains(t, setCookie, "HttpOnly")
	require.Contains(t, setCookie, "SameSite=Strict")
	require.Contains(t, setCookie, "Path=/")
	require.NotContains(t, setCookie, common.SessionSecret)
}
