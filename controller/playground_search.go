package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

// PlaygroundSearch runs a web search on behalf of the playground so that ANY
// model (including Claude on Bedrock, which has no native web-search tool) can
// ground answers in fresh information via a standard `web_search` function call.
//
// Flow: model emits tool_call(web_search,{query}) -> browser (session) ->
// /pg/search -> Tavily Search API -> formatted results returned to the browser,
// which feeds them back to the model as the tool result.
//
// The user is already authenticated by UserAuth middleware; the Tavily key is
// never exposed to the browser.
//
// Config (env on the newapi service):
//
//	TAVILY_API_KEY - Tavily Search API key (from Secret Manager)
func PlaygroundSearch(c *gin.Context) {
	apiKey := strings.TrimSpace(common.GetEnvOrDefaultString("TAVILY_API_KEY", ""))
	if apiKey == "" {
		c.JSON(http.StatusNotImplemented, gin.H{"ok": false, "error": "web search is not configured"})
		return
	}

	var req struct {
		Query string `json:"query"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid request body"})
		return
	}
	query := strings.TrimSpace(req.Query)
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "query is required"})
		return
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
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "failed to encode request"})
		return
	}

	upstream, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, "https://api.tavily.com/search", bytes.NewReader(payload))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "failed to build request"})
		return
	}
	upstream.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(upstream)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "search unavailable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "failed to read search response"})
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": fmt.Sprintf("search provider returned %d", resp.StatusCode)})
		return
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
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "failed to parse search response"})
		return
	}

	// Build a compact, model-friendly context string from the results. This is
	// what the browser feeds back to the model as the tool result.
	var sb strings.Builder
	if strings.TrimSpace(tav.Answer) != "" {
		sb.WriteString("Summary: ")
		sb.WriteString(strings.TrimSpace(tav.Answer))
		sb.WriteString("\n\n")
	}
	sb.WriteString("Search results:\n")
	results := make([]gin.H, 0, len(tav.Results))
	for i, r := range tav.Results {
		content := strings.TrimSpace(r.Content)
		if len([]rune(content)) > 600 {
			content = string([]rune(content)[:600]) + "…"
		}
		sb.WriteString(fmt.Sprintf("[%d] %s (%s)\n%s\n\n", i+1, r.Title, r.URL, content))
		results = append(results, gin.H{"title": r.Title, "url": r.URL, "content": content})
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"query":   query,
		"answer":  tav.Answer,
		"results": results,
		"context": strings.TrimSpace(sb.String()),
	})
}
