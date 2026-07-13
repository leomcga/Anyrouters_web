package common

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

var analyticsIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func IsProduction() bool {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return environment == "production" || environment == "prod"
}

func ParseExactOrigins(raw string) ([]string, error) {
	seen := make(map[string]struct{})
	origins := make([]string, 0)
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parsed, err := url.Parse(item)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" ||
			(parsed.Scheme != "https" && (!(!IsProduction() && parsed.Scheme == "http"))) ||
			parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
			(parsed.Path != "" && parsed.Path != "/") {
			return nil, fmt.Errorf("invalid trusted origin")
		}
		origin := strings.ToLower(parsed.Scheme + "://" + parsed.Host)
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	sort.Strings(origins)
	return origins, nil
}

func IsAllowedOrigin(origin string, allowed []string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return false
	}
	canonical := strings.ToLower(parsed.Scheme + "://" + parsed.Host)
	for _, candidate := range allowed {
		if canonical == candidate {
			return true
		}
	}
	return false
}

func ValidateExternalWebURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("invalid external URL")
	}
	if parsed.Scheme != "https" || parsed.User != nil {
		return errors.New("external URL must use HTTPS without user info")
	}
	return nil
}

func ValidatePublicBaseURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return errors.New("invalid public base URL")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("public base URL cannot contain query or fragment")
	}
	if IsProduction() && parsed.Scheme != "https" {
		return errors.New("production public base URL must use HTTPS")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("public base URL must use HTTP or HTTPS")
	}
	return nil
}

func richTextPolicy() *bluemonday.Policy {
	policy := bluemonday.UGCPolicy()
	policy.AllowAttrs("class").Matching(regexp.MustCompile(`^[A-Za-z0-9 _:-]{1,256}$`)).Globally()
	policy.AllowAttrs("target").Matching(regexp.MustCompile(`^_blank$`)).OnElements("a")
	policy.RequireNoFollowOnLinks(true)
	policy.RequireNoReferrerOnLinks(true)
	policy.AddTargetBlankToFullyQualifiedLinks(true)
	policy.AllowURLSchemes("http", "https", "mailto")
	return policy
}

func SanitizeRichText(value string) string {
	return richTextPolicy().Sanitize(value)
}

func NormalizeWebContentOption(key string, value string) (string, error) {
	switch key {
	case "ServerAddress":
		trimmed := strings.TrimRight(strings.TrimSpace(value), "/")
		if err := ValidatePublicBaseURL(trimmed); err != nil {
			return "", err
		}
		return trimmed, nil
	case "Notice", "Footer", "legal.user_agreement", "legal.privacy_policy":
		return SanitizeRichText(value), nil
	case "About", "HomePageContent":
		trimmed := strings.TrimSpace(value)
		if strings.HasPrefix(strings.ToLower(trimmed), "http:") ||
			strings.HasPrefix(strings.ToLower(trimmed), "https:") {
			if err := ValidateExternalWebURL(trimmed); err != nil {
				return "", err
			}
			return trimmed, nil
		}
		return SanitizeRichText(value), nil
	case "console_setting.announcements":
		return sanitizeJSONRichTextFields(value, "content", "extra")
	case "console_setting.faq":
		return sanitizeJSONRichTextFields(value, "question", "answer")
	default:
		return value, nil
	}
}

func sanitizeJSONRichTextFields(raw string, fields ...string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return raw, nil
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return "", err
	}
	for _, item := range items {
		for _, field := range fields {
			if value, ok := item[field].(string); ok {
				item[field] = SanitizeRichText(value)
			}
		}
	}
	normalized, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

func ValidAnalyticsID(value string) bool {
	return analyticsIDPattern.MatchString(strings.TrimSpace(value))
}

func InlineScriptHash(script string) string {
	sum := sha256.Sum256([]byte(script))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}
