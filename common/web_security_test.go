package common

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSanitizeRichTextBlocksActiveContent(t *testing.T) {
	payloads := []string{
		`<script>alert(1)</script><p>safe</p>`,
		`<img src=x onerror=alert(1)>`,
		`<svg onload=alert(1)><circle /></svg>`,
		`<iframe src="https://example.com"></iframe>`,
		`<object data="https://example.com"></object>`,
		`<embed src="https://example.com">`,
		`<a href="javascript:alert(1)">click</a>`,
		`<math><mtext><img src=x onerror=alert(1)></mtext></math>`,
	}
	for _, payload := range payloads {
		sanitized := strings.ToLower(SanitizeRichText(payload))
		for _, forbidden := range []string{
			"<script", "<iframe", "<object", "<embed", "<svg", "<math",
			"onerror", "onload", "javascript:",
		} {
			require.NotContains(t, sanitized, forbidden, payload)
		}
	}
	require.Contains(t, SanitizeRichText(`<p><strong>safe</strong> <a href="https://example.com">link</a></p>`), "<strong>safe</strong>")
}

func TestNormalizeWebContentOptionSanitizesNestedJSON(t *testing.T) {
	normalized, err := NormalizeWebContentOption(
		"console_setting.announcements",
		`[{"content":"<img src=x onerror=alert(1)>ok","extra":"<script>x</script>safe"}]`,
	)
	require.NoError(t, err)
	require.NotContains(t, strings.ToLower(normalized), "onerror")
	require.NotContains(t, strings.ToLower(normalized), "<script")
	require.Contains(t, normalized, "safe")
}

func TestExactOriginsRejectWildcardAndPrefixConfusion(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	_, err := ParseExactOrigins("*")
	require.Error(t, err)

	origins, err := ParseExactOrigins("https://app.example.com")
	require.NoError(t, err)
	require.True(t, IsAllowedOrigin("https://app.example.com", origins))
	require.False(t, IsAllowedOrigin("https://app.example.com.evil.test", origins))
	require.False(t, IsAllowedOrigin("https://evil.test/app.example.com", origins))
}

func TestValidateWebSecurityConfigProductionSessionSecret(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("SESSION_SECRET", "short")
	require.Error(t, ValidateWebSecurityConfig())
	t.Setenv("SESSION_SECRET", strings.Repeat("x", 32))
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
	require.NoError(t, ValidateWebSecurityConfig())
}
