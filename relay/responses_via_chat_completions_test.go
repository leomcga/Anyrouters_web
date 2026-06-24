package relay

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service/openaicompat"

	"github.com/gin-gonic/gin"
)

// Build a Responses request that mirrors what Codex sends mid-conversation:
// instructions + user text + a prior assistant function_call + its
// function_call_output + a function tool definition.
func TestResponsesRequestToChat_PreservesToolHistory(t *testing.T) {
	inputJSON := `[
		{"type":"message","role":"user","content":[{"type":"input_text","text":"list files"}]},
		{"type":"function_call","call_id":"call_1","name":"shell","arguments":"{\"cmd\":\"ls\"}"},
		{"type":"function_call_output","call_id":"call_1","output":"a.txt\nb.txt"},
		{"type":"message","role":"user","content":"thanks"}
	]`
	toolsJSON := `[{"type":"function","name":"shell","description":"run shell","parameters":{"type":"object","properties":{"cmd":{"type":"string"}}}}]`

	stream := true
	req := &dto.OpenAIResponsesRequest{
		Model:        "claude-sonnet-4-6",
		Instructions: []byte(`"you are helpful"`),
		Input:        []byte(inputJSON),
		Tools:        []byte(toolsJSON),
		Stream:       &stream,
	}

	chat, err := openaicompat.ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert error: %v", err)
	}

	// Expect: system, user, assistant(tool_calls), tool, user
	if len(chat.Messages) != 5 {
		t.Fatalf("want 5 messages, got %d: %+v", len(chat.Messages), chat.Messages)
	}
	if chat.Messages[0].Role != "system" || chat.Messages[0].StringContent() != "you are helpful" {
		t.Errorf("message[0] not system instructions: %+v", chat.Messages[0])
	}
	if chat.Messages[1].Role != "user" || chat.Messages[1].StringContent() != "list files" {
		t.Errorf("message[1] not user text: %+v", chat.Messages[1])
	}
	assistant := chat.Messages[2]
	if assistant.Role != "assistant" {
		t.Errorf("message[2] role = %s, want assistant", assistant.Role)
	}
	tcs := assistant.ParseToolCalls()
	if len(tcs) != 1 || tcs[0].ID != "call_1" || tcs[0].Function.Name != "shell" {
		t.Errorf("assistant tool_calls wrong: %+v", tcs)
	}
	if !strings.Contains(tcs[0].Function.Arguments, "ls") {
		t.Errorf("assistant tool args lost: %q", tcs[0].Function.Arguments)
	}
	if chat.Messages[3].Role != "tool" || chat.Messages[3].ToolCallId != "call_1" {
		t.Errorf("message[3] not tool result: %+v", chat.Messages[3])
	}
	if chat.Messages[4].Role != "user" || chat.Messages[4].StringContent() != "thanks" {
		t.Errorf("message[4] not user: %+v", chat.Messages[4])
	}

	// Tools converted to nested Chat shape
	if len(chat.Tools) != 1 || chat.Tools[0].Type != "function" || chat.Tools[0].Function.Name != "shell" {
		t.Errorf("tools not converted: %+v", chat.Tools)
	}
	if chat.Stream == nil || !*chat.Stream {
		t.Errorf("stream flag lost")
	}
}

// Drive the streaming bridge with text + a tool call + a usage chunk, and
// assert the emitted Responses SSE has the event sequence Codex needs.
func TestResponsesStreamBridge_EmitsResponsesEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	bridge := newResponsesStreamBridge(c.Writer, "resp_test", "claude-sonnet-4-6", 1700000000)

	mk := func(s string) *string { return &s }
	idx0 := 0

	// role chunk
	bridge.handleChatChunk(&dto.ChatCompletionsStreamResponse{
		Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Role: "assistant"}}},
	})
	// text delta
	bridge.handleChatChunk(&dto.ChatCompletionsStreamResponse{
		Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Content: mk("Hello")}}},
	})
	// tool call open + first args fragment
	bridge.handleChatChunk(&dto.ChatCompletionsStreamResponse{
		Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{{Index: &idx0, ID: "call_9", Type: "function", Function: dto.FunctionResponse{Name: "shell", Arguments: "{\"cmd\""}}},
		}}},
	})
	// tool args continued
	bridge.handleChatChunk(&dto.ChatCompletionsStreamResponse{
		Choices: []dto.ChatCompletionsStreamResponseChoice{{Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
			ToolCalls: []dto.ToolCallResponse{{Index: &idx0, Function: dto.FunctionResponse{Arguments: ":\"ls\"}"}}},
		}}},
	})
	// usage chunk
	bridge.handleChatChunk(&dto.ChatCompletionsStreamResponse{
		Usage: &dto.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	})
	bridge.finish(&dto.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15})

	out := rec.Body.String()
	required := []string{
		"event: response.created",
		"event: response.in_progress",
		"event: response.output_item.added",
		"event: response.content_part.added",
		"event: response.output_text.delta",
		"event: response.output_text.done",
		"event: response.content_part.done",
		"event: response.function_call_arguments.delta",
		"event: response.function_call_arguments.done",
		"event: response.completed",
		`"call_id":"call_9"`,
		`"name":"shell"`,
		`"input_tokens":10`,
	}
	for _, r := range required {
		if !strings.Contains(out, r) {
			t.Errorf("missing %q in bridge output", r)
		}
	}
	if !strings.Contains(out, `{\"cmd\":\"ls\"}`) {
		t.Errorf("final arguments not assembled in output:\n%s", out)
	}
	if strings.LastIndex(out, "event: response.completed") < strings.LastIndex(out, "event: response.output_item.done") {
		t.Errorf("response.completed not emitted last")
	}
}
