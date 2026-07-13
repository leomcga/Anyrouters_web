package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func securityTestEngine() *gin.Engine {
	engine := gin.New()
	engine.Use(SecurityHeaders(), CORS())
	engine.GET("/api/private", func(c *gin.Context) { c.Status(http.StatusOK) })
	engine.GET("/v1/models", func(c *gin.Context) { c.Status(http.StatusOK) })
	return engine
}

func TestSecurityHeadersProduction(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/private", nil)
	securityTestEngine().ServeHTTP(recorder, request)
	require.Equal(t, "nosniff", recorder.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", recorder.Header().Get("X-Frame-Options"))
	require.Contains(t, recorder.Header().Get("Content-Security-Policy"), "object-src 'none'")
	require.Contains(t, recorder.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'")
	require.NotContains(t, recorder.Header().Get("Content-Security-Policy"), "script-src 'self' 'unsafe-inline'")
	require.Contains(t, recorder.Header().Get("Strict-Transport-Security"), "max-age=")
	require.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
}

func TestHSTSDevelopmentDisabled(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/private", nil)
	securityTestEngine().ServeHTTP(recorder, request)
	require.Empty(t, recorder.Header().Get("Strict-Transport-Security"))
}

func TestCORSExactCredentialOrigin(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
	engine := securityTestEngine()

	allowed := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/private", nil)
	request.Header.Set("Origin", "https://app.example.com")
	engine.ServeHTTP(allowed, request)
	require.Equal(t, http.StatusNoContent, allowed.Code)
	require.Equal(t, "https://app.example.com", allowed.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, "true", allowed.Header().Get("Access-Control-Allow-Credentials"))

	rejected := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/api/private", nil)
	request.Header.Set("Origin", "https://app.example.com.evil.test")
	engine.ServeHTTP(rejected, request)
	require.Equal(t, http.StatusForbidden, rejected.Code)
	require.Empty(t, rejected.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORSPublicTokenRouteNeverAllowsCredentialsWithWildcard(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	request.Header.Set("Origin", "https://sdk.example")
	securityTestEngine().ServeHTTP(recorder, request)
	require.Equal(t, "*", recorder.Header().Get("Access-Control-Allow-Origin"))
	require.Empty(t, recorder.Header().Get("Access-Control-Allow-Credentials"))
}

func TestEnforceHTTPSDoesNotTrustHostHeader(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("SERVER_ADDRESS", "https://app.example.com")
	engine := gin.New()
	engine.Use(EnforceHTTPS())
	engine.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://evil.test/path?q=1", nil)
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusPermanentRedirect, recorder.Code)
	require.Equal(t, "https://app.example.com/path?q=1", recorder.Header().Get("Location"))
	require.False(t, strings.Contains(recorder.Header().Get("Location"), "evil.test"))
}
