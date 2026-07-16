package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// TavilyWebSearch runs a Tavily web search and returns a compact, model-friendly
// context string (a short summary plus the top results).
//
// It is the shared core behind both the playground search proxy (/pg/search)
// and the server-side web_search emulation that lets Claude Code use web search
// over Bedrock (which has no native Anthropic web_search server tool).
//
// The Tavily key comes from the TAVILY_API_KEY env (Secret Manager) and is never
// exposed to clients.
func TavilyWebSearch(ctx context.Context, query string) (string, error) {
	apiKey := strings.TrimSpace(common.GetEnvOrDefaultString("TAVILY_API_KEY", ""))
	if apiKey == "" {
		return "", errors.New("web search is not configured")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return "", errors.New("query is required")
	}
	if len([]rune(query)) > 400 {
		query = string([]rune(query)[:400])
	}

	payload, err := common.Marshal(map[string]any{
		"api_key":        apiKey,
		"query":          query,
		"search_depth":   "basic",
		"max_results":    5,
		"include_answer": true,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.tavily.com/search", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("search unavailable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("search provider returned %d", resp.StatusCode)
	}

	var tav struct {
		Answer  string `json:"answer"`
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	if err := common.Unmarshal(body, &tav); err != nil {
		return "", err
	}

	var sb strings.Builder
	if strings.TrimSpace(tav.Answer) != "" {
		sb.WriteString("Summary: ")
		sb.WriteString(strings.TrimSpace(tav.Answer))
		sb.WriteString("\n\n")
	}
	sb.WriteString("Search results:\n")
	for i, r := range tav.Results {
		content := strings.TrimSpace(r.Content)
		if len([]rune(content)) > 600 {
			content = string([]rune(content)[:600]) + "…"
		}
		sb.WriteString(fmt.Sprintf("[%d] %s (%s)\n%s\n\n", i+1, r.Title, r.URL, content))
	}
	if len(tav.Results) == 0 && strings.TrimSpace(tav.Answer) == "" {
		return "No results found.", nil
	}
	return strings.TrimSpace(sb.String()), nil
}
