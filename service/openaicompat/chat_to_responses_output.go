package openaicompat

import (
	"strconv"

	"github.com/QuantumNous/new-api/dto"
)

// Pure builders for the OpenAI Responses API output shape.
//
// These are shared by the streaming bridge (relay.responsesViaChatCompletions)
// and the non-streaming converter below so that the emitted field names stay
// byte-for-byte identical. Clients such as Codex validate the Responses event
// shape strictly, so we build maps directly for exact control.

// BuildResponsesMessageItem builds an assistant `message` output item.
func BuildResponsesMessageItem(itemID, text, status string) map[string]any {
	return map[string]any{
		"type":   "message",
		"id":     itemID,
		"status": status,
		"role":   "assistant",
		"content": []map[string]any{
			{
				"type":        "output_text",
				"text":        text,
				"annotations": []any{},
			},
		},
	}
}

// BuildResponsesOutputTextPart builds an `output_text` content part.
func BuildResponsesOutputTextPart(text string) map[string]any {
	return map[string]any{
		"type":        "output_text",
		"text":        text,
		"annotations": []any{},
	}
}

// BuildResponsesFunctionCallItem builds a `function_call` output item.
func BuildResponsesFunctionCallItem(itemID, callID, name, arguments, status string) map[string]any {
	return map[string]any{
		"type":      "function_call",
		"id":        itemID,
		"status":    status,
		"name":      name,
		"call_id":   callID,
		"arguments": arguments,
	}
}

// BuildResponsesUsage maps Chat Completions usage to the Responses usage shape.
func BuildResponsesUsage(usage *dto.Usage) map[string]any {
	if usage == nil {
		return nil
	}
	input := usage.PromptTokens
	output := usage.CompletionTokens
	total := usage.TotalTokens
	if total == 0 {
		total = input + output
	}
	return map[string]any{
		"input_tokens":  input,
		"output_tokens": output,
		"total_tokens":  total,
		"input_tokens_details": map[string]any{
			"cached_tokens": usage.PromptTokensDetails.CachedTokens,
		},
		"output_tokens_details": map[string]any{
			"reasoning_tokens": usage.CompletionTokenDetails.ReasoningTokens,
		},
	}
}

// BuildResponsesResponseObject builds the `response` object embedded in
// response.created / response.in_progress / response.completed events and
// returned by the non-streaming endpoint.
func BuildResponsesResponseObject(id, model string, createdAt int64, status string, output []map[string]any, usage *dto.Usage) map[string]any {
	if output == nil {
		output = []map[string]any{}
	}
	obj := map[string]any{
		"id":                  id,
		"object":              "response",
		"created_at":          createdAt,
		"status":              status,
		"model":               model,
		"output":              output,
		"parallel_tool_calls": true,
		"tool_choice":         "auto",
		"tools":               []any{},
		"instructions":        nil,
		"metadata":            map[string]any{},
		"error":               nil,
		"incomplete_details":  nil,
	}
	if usage != nil {
		obj["usage"] = BuildResponsesUsage(usage)
	} else {
		obj["usage"] = nil
	}
	return obj
}

// ResponsesItemID returns a stable item id unique within a single response.
func ResponsesItemID(responseID string, outputIndex int) string {
	return responseID + "_item_" + strconv.Itoa(outputIndex)
}

// ChatCompletionsResponseToResponsesResponse converts a non-streaming Chat
// Completions response into a Responses API response object (as a map for exact
// field control) plus the resolved usage.
func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, id, model string, createdAt int64) (map[string]any, *dto.Usage) {
	usage := &dto.Usage{}
	var output []map[string]any
	outputIndex := 0

	if resp != nil {
		usage = &resp.Usage
		if resp.Model != "" {
			model = resp.Model
		}
		if len(resp.Choices) > 0 {
			choice := resp.Choices[0]
			if text := choice.Message.StringContent(); text != "" {
				output = append(output, BuildResponsesMessageItem(ResponsesItemID(id, outputIndex), text, "completed"))
				outputIndex++
			}
			for _, tc := range choice.Message.ParseToolCalls() {
				if tc.Function.Name == "" {
					continue
				}
				output = append(output, BuildResponsesFunctionCallItem(ResponsesItemID(id, outputIndex), tc.ID, tc.Function.Name, tc.Function.Arguments, "completed"))
				outputIndex++
			}
		}
	}

	return BuildResponsesResponseObject(id, model, createdAt, "completed", output, usage), usage
}
