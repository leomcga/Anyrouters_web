package relay

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"

	"github.com/gin-gonic/gin"
)

func strPtr(s string) *string { return &s }

func TestHasAndReplaceClaudeWebSearchTool(t *testing.T) {
	req := &dto.ClaudeRequest{
		Model: "claude-sonnet-4-6",
		Tools: []any{
			map[string]any{"type": "web_search_20250305", "name": "web_search", "max_uses": float64(5)},
			map[string]any{"name": "Bash", "description": "run a shell command", "input_schema": map[string]any{"type": "object"}},
		},
	}

	if !hasClaudeWebSearchServerTool(req) {
		t.Fatal("expected web_search server tool to be detected")
	}

	replaceClaudeWebSearchToolWithCustom(req)
	tools := normalizeClaudeTools(req.Tools)
	if len(tools) != 2 {
		t.Fatalf("want 2 tools after replace, got %d", len(tools))
	}
	// web_search must now be a custom function tool (no server type, has input_schema)
	var foundCustomWebSearch, foundBash bool
	for _, tl := range tools {
		name, _ := tl["name"].(string)
		if name == "web_search" {
			if _, hasType := tl["type"]; hasType {
				t.Errorf("web_search should no longer carry a server tool type: %+v", tl)
			}
			if _, hasSchema := tl["input_schema"]; !hasSchema {
				t.Errorf("custom web_search must have input_schema: %+v", tl)
			}
			foundCustomWebSearch = true
		}
		if name == "Bash" {
			foundBash = true
		}
	}
	if !foundCustomWebSearch || !foundBash {
		t.Errorf("expected both custom web_search and untouched Bash tool; web_search=%v bash=%v", foundCustomWebSearch, foundBash)
	}
	if hasClaudeWebSearchServerTool(req) {
		t.Error("server tool should be gone after replacement")
	}
}

func TestClassifyClaudeToolUses(t *testing.T) {
	resp := &dto.ClaudeResponse{
		Content: []dto.ClaudeMediaMessage{
			{Type: "text", Text: strPtr("let me search")},
			{Type: "tool_use", Id: "tu_1", Name: "web_search", Input: map[string]any{"query": "weather beijing"}},
			{Type: "tool_use", Id: "tu_2", Name: "Bash", Input: map[string]any{"command": "ls"}},
		},
	}
	ws, other := classifyClaudeToolUses(resp)
	if len(ws) != 1 || ws[0].id != "tu_1" || ws[0].query != "weather beijing" {
		t.Errorf("web_search classification wrong: %+v", ws)
	}
	if other != 1 {
		t.Errorf("want otherCount=1 (Bash), got %d", other)
	}
}

func TestEmitClaudeResponseAsStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	resp := &dto.ClaudeResponse{
		Id:         "msg_abc",
		StopReason: "end_turn",
		Content: []dto.ClaudeMediaMessage{
			{Type: "text", Text: strPtr("Beijing is sunny today.")},
		},
	}
	emitClaudeResponseAsStream(c, resp, &dto.Usage{PromptTokens: 1200, CompletionTokens: 18}, "claude-sonnet-4-6")

	out := rec.Body.String()
	required := []string{
		"event: message_start",
		"event: content_block_start",
		"event: content_block_delta",
		"event: content_block_stop",
		"event: message_delta",
		"event: message_stop",
		`"text":"Beijing is sunny today."`,
		`"input_tokens":1200`,
		`"output_tokens":18`,
		`"stop_reason":"end_turn"`,
	}
	for _, r := range required {
		if !strings.Contains(out, r) {
			t.Errorf("missing %q in synthesized claude stream", r)
		}
	}
	// message_start must come before message_stop
	if strings.Index(out, "event: message_start") > strings.Index(out, "event: message_stop") {
		t.Error("message_start must precede message_stop")
	}
}

func TestEmitClaudeResponseAsStream_ToolUse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	resp := &dto.ClaudeResponse{
		Id:         "msg_t",
		StopReason: "tool_use",
		Content: []dto.ClaudeMediaMessage{
			{Type: "tool_use", Id: "toolu_9", Name: "Bash", Input: map[string]any{"command": "ls -la"}},
		},
	}
	emitClaudeResponseAsStream(c, resp, &dto.Usage{PromptTokens: 50, CompletionTokens: 12}, "claude-sonnet-4-6")

	out := rec.Body.String()
	for _, r := range []string{
		`"type":"tool_use"`,
		`"name":"Bash"`,
		`"id":"toolu_9"`,
		"input_json_delta",
		`ls -la`,
	} {
		if !strings.Contains(out, r) {
			t.Errorf("missing %q in tool_use stream output:\n%s", r, out)
		}
	}
}
