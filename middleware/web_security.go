package middleware

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

var corsAllowedHeaders = "Authorization, Content-Type, Accept, Origin, X-Requested-With, X-Oneapi-Request-Id, X-Api-Key, Anthropic-Version"

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)")
		c.Header("Content-Security-Policy", contentSecurityPolicy())
		if common.IsProduction() {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api/") ||
			strings.HasPrefix(c.Request.URL.Path, "/pg/") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	}
}

func EnforceHTTPS() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.IsProduction() || requestIsHTTPS(c.Request) {
			c.Next()
			return
		}
		host := trustedPublicHost()
		if host == "" {
			c.AbortWithStatusJSON(http.StatusUpgradeRequired, gin.H{
				"success": false,
				"message": "HTTPS is required",
			})
			return
		}
		target := "https://" + host + c.Request.URL.RequestURI()
		c.Redirect(http.StatusPermanentRedirect, target)
		c.Abort()
	}
}

func requestIsHTTPS(request *http.Request) bool {
	if request.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(request.Header.Get("X-Forwarded-Proto")), "https")
}

func trustedPublicHost() string {
	raw := strings.TrimSpace(os.Getenv("SERVER_ADDRESS"))
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" {
		return ""
	}
	return parsed.Host
}

func contentSecurityPolicy() string {
	scriptSources := []string{"'self'"}
	if googleID := strings.TrimSpace(os.Getenv("GOOGLE_ANALYTICS_ID")); common.ValidAnalyticsID(googleID) {
		scriptSources = append(scriptSources, "https://www.googletagmanager.com")
		scriptSources = append(scriptSources, common.InlineScriptHash(googleAnalyticsInlineScript(googleID)))
	}
	if raw := strings.TrimSpace(os.Getenv("UMAMI_SCRIPT_URL")); raw != "" {
		if parsed, err := url.Parse(raw); err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil {
			scriptSources = append(scriptSources, parsed.Scheme+"://"+parsed.Host)
		}
	} else if strings.TrimSpace(os.Getenv("UMAMI_WEBSITE_ID")) != "" {
		scriptSources = append(scriptSources, "https://analytics.umami.is")
	}
	directives := []string{
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"script-src " + strings.Join(scriptSources, " "),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"connect-src 'self' https: wss:",
		"frame-src https:",
		"worker-src 'self' blob:",
		"form-action 'self' https:",
	}
	if common.IsProduction() {
		directives = append(directives, "upgrade-insecure-requests")
	}
	return strings.Join(directives, "; ")
}

func googleAnalyticsInlineScript(id string) string {
	return fmt.Sprintf(
		"window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '%s');",
		id,
	)
}

func CORS() gin.HandlerFunc {
	allowedOrigins, err := common.ParseExactOrigins(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if err != nil {
		common.SysError("invalid CORS_ALLOWED_ORIGINS configuration; cross-origin credential requests are disabled")
		allowedOrigins = nil
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			c.Next()
			return
		}

		trustedCredentialOrigin := common.IsAllowedOrigin(origin, allowedOrigins)
		publicTokenRoute := isPublicTokenRoute(c.Request.URL.Path) && c.GetHeader("Cookie") == ""
		switch {
		case trustedCredentialOrigin:
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
		case publicTokenRoute:
			c.Header("Access-Control-Allow-Origin", "*")
		default:
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", corsAllowedHeaders)
		c.Header("Access-Control-Expose-Headers", "X-Oneapi-Request-Id, Retry-After")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func isPublicTokenRoute(path string) bool {
	return strings.HasPrefix(path, "/v1/") ||
		strings.HasPrefix(path, "/v1beta/") ||
		strings.HasPrefix(path, "/dashboard/") ||
		strings.HasPrefix(path, "/mj/") ||
		strings.HasPrefix(path, "/suno/")
}

func SafePanicRecovery() gin.RecoveryFunc {
	return func(c *gin.Context, recovered any) {
		requestID := c.GetString(common.RequestIdKey)
		common.SysError(fmt.Sprintf("request panic recovered request_id=%s", requestID))
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "Internal server error",
				"type":    "internal_error",
			},
		})
	}
}
