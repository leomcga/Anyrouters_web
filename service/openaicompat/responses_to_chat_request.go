package openaicompat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ResponsesRequestToChatCompletionsRequest converts an OpenAI Responses API
// request into a Chat Completions request. It is the inverse of
// ChatCompletionsRequestToResponsesRequest.
//
// This lets channels that do not implement /v1/responses natively
// (Claude/Bedrock, Gemini/Vertex, and any OpenAI-compatible upstream that only
// speaks Chat Completions) still serve the Responses API by bridging through
// the fully-supported Chat Completions path. Clients that require
// wire_api="responses" — most notably Codex — work against any such upstream.
//
// Conversation history is preserved faithfully: role messages, assistant
// function_call items, and function_call_output (tool result) items are mapped
// back to Chat Completions messages and tool_calls. ParseInput is deliberately
// NOT used here because it flattens everything to media and drops roles/tool
// items, which Codex relies on.
func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	if req == nil {
		return nil, errors.New("request is nil")
	}
	if req.Model == "" {
		return nil, errors.New("model is required")
	}

	messages := make([]dto.Message, 0, 8)

	// instructions -> leading system message
	if instr := parseResponsesInstructions(req.Instructions); instr != "" {
		messages = append(messages, dto.Message{Role: "system", Content: instr})
	}

	// input -> messages (roles, function_call, function_call_output)
	inputMsgs, err := parseResponsesInputToMessages(req.Input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, inputMsgs...)

	out := &dto.GeneralOpenAIRequest{
		Model:       req.Model,
		Messages:    messages,
		Temperature: req.Temperature,
		TopP:        req.TopP,
		MaxTokens:   req.MaxOutputTokens,
		Metadata:    req.Metadata,
		Store:       req.Store,
	}
	if req.Stream != nil {
		out.Stream = req.Stream
	}
	if len(req.User) > 0 {
		out.User = req.User
	}
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		out.ReasoningEffort = req.Reasoning.Effort
	}
	if tools, err := convertResponsesToolsToChat(req.Tools); err == nil && len(tools) > 0 {
		out.Tools = tools
	}
	if tc := convertResponsesToolChoiceToChat(req.ToolChoice); tc != nil {
		out.ToolChoice = tc
	}
	if len(req.ParallelToolCalls) > 0 {
		var b bool
		if err := common.Unmarshal(req.ParallelToolCalls, &b); err == nil {
			out.ParallelTooCalls = &b
		}
	}
	if rf := convertResponsesTextToChatResponseFormat(req.Text); rf != nil {
		out.ResponseFormat = rf
	}

	return out, nil
}

type respMsgBuilder struct {
	role       string
	content    any
	toolCalls  []dto.ToolCallRequest
	toolCallID string
	isTool     bool
}

func parseResponsesInputToMessages(raw json.RawMessage) ([]dto.Message, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	// input may be a bare string
	if common.GetJsonType(raw) == "string" {
		var s string
		_ = common.Unmarshal(raw, &s)
		return []dto.Message{{Role: "user", Content: s}}, nil
	}

	if common.GetJsonType(raw) != "array" {
		return nil, fmt.Errorf("unsupported responses input type")
	}

	var items []map[string]any
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, err
	}

	builders := make([]*respMsgBuilder, 0, len(items))

	// Merge a function_call into the trailing assistant message when possible so
	// the Chat Completions shape (one assistant message carrying content +
	// tool_calls) is preserved; otherwise open a fresh assistant message.
	appendAssistantToolCall := func(tc dto.ToolCallRequest) {
		if n := len(builders); n > 0 && builders[n-1].role == "assistant" && !builders[n-1].isTool {
			builders[n-1].toolCalls = append(builders[n-1].toolCalls, tc)
			return
		}
		builders = append(builders, &respMsgBuilder{role: "assistant", content: "", toolCalls: []dto.ToolCallRequest{tc}})
	}

	for _, it := range items {
		typ := common.Interface2String(it["type"])
		switch typ {
		case "function_call":
			callID := firstNonEmptyString(common.Interface2String(it["call_id"]), common.Interface2String(it["id"]))
			appendAssistantToolCall(dto.ToolCallRequest{
				ID:   callID,
				Type: "function",
				Function: dto.FunctionRequest{
					Name:      common.Interface2String(it["name"]),
					Arguments: responsesArgumentsToString(it["arguments"]),
				},
			})
		case "function_call_output":
			builders = append(builders, &respMsgBuilder{
				role:       "tool",
				isTool:     true,
				toolCallID: common.Interface2String(it["call_id"]),
				content:    responsesOutputToString(it["output"]),
			})
		case "reasoning", "item_reference":
			// Reasoning items carry no chat-visible content; skip.
		case "message", "":
			role := common.Interface2String(it["role"])
			if role == "" {
				continue
			}
			// Responses/Codex use the "developer" role for system-level
			// instructions; downstream Chat→Claude/Gemini only accept
			// system/user/assistant, so normalize it to system.
			if role == "developer" {
				role = "system"
			}
			builders = append(builders, &respMsgBuilder{
				role:    role,
				content: parseResponsesContent(it["content"]),
			})
		default:
			// Unknown item type; ignore rather than fail the whole request.
		}
	}

	msgs := make([]dto.Message, 0, len(builders))
	for _, b := range builders {
		m := dto.Message{Role: b.role}
		if b.isTool {
			m.ToolCallId = b.toolCallID
			m.Content = b.content
		} else {
			m.Content = b.content
			if len(b.toolCalls) > 0 {
				m.SetToolCalls(b.toolCalls)
			}
		}
		msgs = append(msgs, m)
	}
	return msgs, nil
}

// parseResponsesContent maps a Responses message `content` (string or array of
// content parts) into a Chat Completions message content (string when text-only,
// otherwise a media-content slice).
func parseResponsesContent(content any) any {
	switch v := content.(type) {
	case string:
		return v
	case []any:
		var hasNonText bool
		var sb strings.Builder
		media := make([]dto.MediaContent, 0, len(v))
		for _, p := range v {
			pm, ok := p.(map[string]any)
			if !ok {
				continue
			}
			switch common.Interface2String(pm["type"]) {
			case "input_text", "output_text", "text", "summary_text":
				txt := common.Interface2String(pm["text"])
				sb.WriteString(txt)
				media = append(media, dto.MediaContent{Type: dto.ContentTypeText, Text: txt})
			case "input_image":
				hasNonText = true
				media = append(media, dto.MediaContent{
					Type:     dto.ContentTypeImageURL,
					ImageUrl: map[string]any{"url": responsesURLField(pm["image_url"])},
				})
			case "input_file":
				hasNonText = true
				media = append(media, dto.MediaContent{Type: dto.ContentTypeFile, File: pm["file"]})
			default:
				if txt := common.Interface2String(pm["text"]); txt != "" {
					sb.WriteString(txt)
					media = append(media, dto.MediaContent{Type: dto.ContentTypeText, Text: txt})
				}
			}
		}
		if hasNonText {
			return media
		}
		return sb.String()
	}
	return ""
}

func parseResponsesInstructions(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	switch common.GetJsonType(raw) {
	case "string":
		var s string
		_ = common.Unmarshal(raw, &s)
		return s
	case "array":
		var arr []any
		_ = common.Unmarshal(raw, &arr)
		var sb strings.Builder
		for _, it := range arr {
			var txt string
			switch v := it.(type) {
			case string:
				txt = v
			case map[string]any:
				txt = common.Interface2String(v["text"])
			}
			if txt == "" {
				continue
			}
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(txt)
		}
		return sb.String()
	}
	return ""
}

func convertResponsesToolsToChat(raw json.RawMessage) ([]dto.ToolCallRequest, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var arr []map[string]any
	if err := common.Unmarshal(raw, &arr); err != nil {
		return nil, err
	}
	tools := make([]dto.ToolCallRequest, 0, len(arr))
	for _, t := range arr {
		switch common.Interface2String(t["type"]) {
		case "function", "":
			// Responses function tools are flat: {type:function, name, description, parameters}.
			if name := common.Interface2String(t["name"]); name != "" {
				tools = append(tools, dto.ToolCallRequest{
					Type: "function",
					Function: dto.FunctionRequest{
						Name:        name,
						Description: common.Interface2String(t["description"]),
						Parameters:  t["parameters"],
					},
				})
				continue
			}
			// Tolerate a nested {function:{...}} shape just in case.
			if fn, ok := t["function"].(map[string]any); ok {
				if name := common.Interface2String(fn["name"]); name != "" {
					tools = append(tools, dto.ToolCallRequest{
						Type: "function",
						Function: dto.FunctionRequest{
							Name:        name,
							Description: common.Interface2String(fn["description"]),
							Parameters:  fn["parameters"],
						},
					})
				}
			}
		default:
			// Built-in tools (web_search, file_search, ...) have no Chat
			// Completions function equivalent; drop them.
		}
	}
	return tools, nil
}

func convertResponsesToolChoiceToChat(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	if common.GetJsonType(raw) == "string" {
		var s string
		_ = common.Unmarshal(raw, &s)
		return s
	}
	var m map[string]any
	if err := common.Unmarshal(raw, &m); err != nil {
		return nil
	}
	if common.Interface2String(m["type"]) == "function" {
		if name := common.Interface2String(m["name"]); name != "" {
			return map[string]any{"type": "function", "function": map[string]any{"name": name}}
		}
	}
	return m
}

func convertResponsesTextToChatResponseFormat(raw json.RawMessage) *dto.ResponseFormat {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := common.Unmarshal(raw, &m); err != nil {
		return nil
	}
	format, ok := m["format"].(map[string]any)
	if !ok {
		return nil
	}
	t := common.Interface2String(format["type"])
	if t == "" {
		return nil
	}
	rf := &dto.ResponseFormat{Type: t}
	if t == "json_schema" {
		if js, err := common.Marshal(format); err == nil {
			rf.JsonSchema = js
		}
	}
	return rf
}

func responsesArgumentsToString(v any) string {
	switch vv := v.(type) {
	case nil:
		return ""
	case string:
		return vv
	default:
		if b, err := common.Marshal(vv); err == nil {
			return string(b)
		}
		return ""
	}
}

func responsesOutputToString(v any) string {
	switch vv := v.(type) {
	case nil:
		return ""
	case string:
		return vv
	default:
		if b, err := common.Marshal(vv); err == nil {
			return string(b)
		}
		return ""
	}
}

func responsesURLField(v any) string {
	switch vv := v.(type) {
	case string:
		return vv
	case map[string]any:
		return common.Interface2String(vv["url"])
	}
	return ""
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
