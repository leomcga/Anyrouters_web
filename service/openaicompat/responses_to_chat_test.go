package openaicompat

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

func TestResponsesResponseToChatCompletionsResponsePreservesIncompleteReason(t *testing.T) {
	status := json.RawMessage(`"incomplete"`)
	resp := &dto.OpenAIResponsesResponse{
		ID:     "resp_1",
		Status: status,
		Model:  "gpt-5.5",
		IncompleteDetails: &dto.IncompleteDetails{
			Reason: "max_output_tokens",
		},
		Output: []dto.ResponsesOutput{{
			Type: "message",
			Role: "assistant",
			Content: []dto.ResponsesOutputContent{{
				Type: "output_text",
				Text: "partial answer",
			}},
		}},
	}

	got, _, err := ResponsesResponseToChatCompletionsResponse(resp, "chatcmpl_1")
	require.NoError(t, err)
	require.Len(t, got.Choices, 1)
	require.Equal(t, "length", got.Choices[0].FinishReason)
	require.Equal(t, "partial answer", got.Choices[0].Message.StringContent())
}

func TestResponsesResponseToChatCompletionsResponseCompletedIsStop(t *testing.T) {
	resp := &dto.OpenAIResponsesResponse{
		Status: json.RawMessage(`"completed"`),
		Model:  "gpt-5.5",
	}

	got, _, err := ResponsesResponseToChatCompletionsResponse(resp, "chatcmpl_1")
	require.NoError(t, err)
	require.Equal(t, "stop", got.Choices[0].FinishReason)
}
