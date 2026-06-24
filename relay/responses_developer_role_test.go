package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service/openaicompat"
)

// Codex sends its system prompt as a role:"developer" input item. Claude/Bedrock
// only accept user/assistant (+ system param), so the converter must normalize
// developer -> system, otherwise Bedrock rejects with
// `Unexpected role "developer"`.
func TestResponsesRequest_DeveloperRoleNormalizedToSystem(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "claude-haiku-4-5",
		Input: []byte(`[
			{"type":"message","role":"developer","content":[{"type":"input_text","text":"You are Codex."}]},
			{"type":"message","role":"user","content":"hi"}
		]`),
	}
	chat, err := openaicompat.ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert error: %v", err)
	}
	if len(chat.Messages) != 2 {
		t.Fatalf("want 2 messages, got %d: %+v", len(chat.Messages), chat.Messages)
	}
	if chat.Messages[0].Role != "system" {
		t.Errorf("developer role should normalize to system, got %q", chat.Messages[0].Role)
	}
	if chat.Messages[0].StringContent() != "You are Codex." {
		t.Errorf("developer content lost: %q", chat.Messages[0].StringContent())
	}
	for _, m := range chat.Messages {
		if m.Role == "developer" {
			t.Error("no message should retain the developer role")
		}
	}
}
