package relay

import (
	"bytes"
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel"
	awschannel "github.com/QuantumNous/new-api/relay/channel/aws"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

const (
	claudeWebSearchToolType  = "web_search_20250305"
	claudeWebSearchToolName  = "web_search"
	claudeWebSearchMaxRounds = 4
)

// isBedrockAdaptor reports whether the channel is AWS Bedrock, which has no
// native Anthropic web_search server tool and therefore needs emulation.
func isBedrockAdaptor(a channel.Adaptor) bool {
	_, ok := a.(*awschannel.Adaptor)
	return ok
}

// hasClaudeWebSearchServerTool reports whether the request carries Anthropic's
// web_search_20250305 server tool — i.e. what Claude Code's WebSearch sends.
func hasClaudeWebSearchServerTool(request *dto.ClaudeRequest) bool {
	for _, t := range normalizeClaudeTools(request.Tools) {
		if common.Interface2String(t["type"]) == claudeWebSearchToolType {
			return true
		}
	}
	return false
}

func normalizeClaudeTools(tools any) []map[string]any {
	if tools == nil {
		return nil
	}
	switch v := tools.(type) {
	case []map[string]any:
		return v
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, it := range v {
			if m, ok := it.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		var out []map[string]any
		b, err := common.Marshal(tools)
		if err != nil {
			return nil
		}
		_ = common.Unmarshal(b, &out)
		return out
	}
}

// replaceClaudeWebSearchToolWithCustom swaps the web_search_20250305 server tool
// for a regular custom function tool Bedrock-Claude can call. All other (client)
// tools are left untouched.
func replaceClaudeWebSearchToolWithCustom(request *dto.ClaudeRequest) {
	tools := normalizeClaudeTools(request.Tools)
	if len(tools) == 0 {
		return
	}
	newTools := make([]any, 0, len(tools))
	for _, t := range tools {
		if common.Interface2String(t["type"]) == claudeWebSearchToolType {
			newTools = append(newTools, map[string]any{
				"name":        claudeWebSearchToolName,
				"description": "Search the web for current, up-to-date information. Provide a concise query; you will receive the top results to ground your answer.",
				"input_schema": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{
							"type":        "string",
							"description": "The search query.",
						},
					},
					"required": []string{"query"},
				},
			})
		} else {
			newTools = append(newTools, t)
		}
	}
	request.Tools = newTools
}

type claudeToolUse struct {
	id    string
	query string
}

func classifyClaudeToolUses(resp *dto.ClaudeResponse) (webSearch []claudeToolUse, otherCount int) {
	if resp == nil {
		return
	}
	for _, block := range resp.Content {
		if block.Type != "tool_use" {
			continue
		}
		if block.Name == claudeWebSearchToolName {
			tu := claudeToolUse{id: block.Id}
			if m, ok := block.Input.(map[string]any); ok {
				tu.query = common.Interface2String(m["query"])
			}
			webSearch = append(webSearch, tu)
		} else {
			otherCount++
		}
	}
	return
}

// claudeWebSearchViaToolLoop emulates Anthropic's web_search server tool over a
// channel that lacks it (Bedrock). It replaces the server tool with a custom
// function tool, runs a bounded server-side loop executing web_search calls via
// Tavily, and hands the model's eventual answer (or any client-tool request)
// back to the caller. Only web_search is handled server-side; all other tool
// calls and final text are returned to the client untouched.
func claudeWebSearchViaToolLoop(c *gin.Context, info *relaycommon.RelayInfo, adaptor channel.Adaptor, request *dto.ClaudeRequest) (*dto.Usage, *types.NewAPIError) {
	clientWantsStream := request.Stream != nil && *request.Stream

	replaceClaudeWebSearchToolWithCustom(request)

	savedIsStream := info.IsStream
	savedRelayFormat := info.RelayFormat
	defer func() {
		info.IsStream = savedIsStream
		info.RelayFormat = savedRelayFormat
	}()
	info.IsStream = false
	info.RelayFormat = types.RelayFormatClaude

	totalUsage := &dto.Usage{}
	streamFalse := false

	var finalResp *dto.ClaudeResponse
	for round := 0; round < claudeWebSearchMaxRounds; round++ {
		// On the final allowed round, drop tools so the model must answer in text.
		if round == claudeWebSearchMaxRounds-1 {
			request.Tools = nil
			request.ToolChoice = nil
		}
		request.Stream = &streamFalse

		resp, apiErr := runClaudeTurnCaptured(c, info, adaptor, request)
		if apiErr != nil {
			return nil, apiErr
		}
		if resp.Usage != nil {
			totalUsage.PromptTokens += resp.Usage.InputTokens
			totalUsage.CompletionTokens += resp.Usage.OutputTokens
		}

		webSearches, otherCount := classifyClaudeToolUses(resp)
		// Hand back to the client if the model answered (no tools) or wants a
		// client-side tool (Bash/Read/Edit/...).
		if len(webSearches) == 0 || otherCount > 0 {
			finalResp = resp
			break
		}

		// Execute every web_search server-side, then continue the conversation.
		assistantBlocks := make([]dto.ClaudeMediaMessage, 0, len(resp.Content))
		for _, block := range resp.Content {
			// Keep text + web_search tool_use; drop any other tool_use so every
			// tool_use in history has a matching tool_result.
			if block.Type == "tool_use" && block.Name != claudeWebSearchToolName {
				continue
			}
			assistantBlocks = append(assistantBlocks, block)
		}
		toolResults := make([]dto.ClaudeMediaMessage, 0, len(webSearches))
		for _, ws := range webSearches {
			resultText, err := service.TavilyWebSearch(c.Request.Context(), ws.query)
			if err != nil {
				resultText = "Web search failed: " + err.Error()
				logger.LogError(c, "claude web_search emulation failed: "+err.Error())
			}
			toolResults = append(toolResults, dto.ClaudeMediaMessage{
				Type:      "tool_result",
				ToolUseId: ws.id,
				Content:   resultText,
			})
		}
		request.Messages = append(request.Messages,
			dto.ClaudeMessage{Role: "assistant", Content: assistantBlocks},
			dto.ClaudeMessage{Role: "user", Content: toolResults},
		)
	}

	totalUsage.TotalTokens = totalUsage.PromptTokens + totalUsage.CompletionTokens
	if finalResp == nil {
		return nil, types.NewError(fmt.Errorf("web search loop produced no final response"), types.ErrorCodeBadResponse)
	}

	model := info.UpstreamModelName
	if model == "" {
		model = request.Model
	}

	if clientWantsStream {
		emitClaudeResponseAsStream(c, finalResp, totalUsage, model)
	} else {
		finalResp.Usage = &dto.ClaudeUsage{
			InputTokens:  totalUsage.PromptTokens,
			OutputTokens: totalUsage.CompletionTokens,
		}
		if finalResp.Model == "" {
			finalResp.Model = model
		}
		c.JSON(http.StatusOK, finalResp)
	}
	return totalUsage, nil
}

// runClaudeTurnCaptured runs one non-streamed Bedrock turn and returns the parsed
// Claude response WITHOUT writing anything to the client (the handler's output is
// captured and discarded).
func runClaudeTurnCaptured(c *gin.Context, info *relaycommon.RelayInfo, adaptor channel.Adaptor, request *dto.ClaudeRequest) (*dto.ClaudeResponse, *types.NewAPIError) {
	convertedRequest, err := adaptor.ConvertClaudeRequest(c, info, request)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)
	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	body, size, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	defer closer.Close()
	info.UpstreamRequestBodySize = size

	resp, err := adaptor.DoRequest(c, info, body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	statusCodeMappingStr := c.GetString("status_code_mapping")
	var httpResp *http.Response
	if resp != nil {
		httpResp = resp.(*http.Response)
		if httpResp.StatusCode != http.StatusOK {
			newAPIError := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			service.ResetStatusCode(newAPIError, statusCodeMappingStr)
			return nil, newAPIError
		}
	}

	realWriter := c.Writer
	var buf bytes.Buffer
	capture := &responsesCaptureWriter{
		ResponseWriter: realWriter,
		header:         http.Header{},
		onWrite:        func(p []byte) { buf.Write(p) },
	}
	c.Writer = capture
	_, apiErr := adaptor.DoResponse(c, httpResp, info)
	c.Writer = realWriter
	if apiErr != nil {
		return nil, apiErr
	}

	var claudeResp dto.ClaudeResponse
	if err := common.Unmarshal(buf.Bytes(), &claudeResp); err != nil {
		return nil, types.NewError(fmt.Errorf("failed to parse upstream claude response: %w", err), types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	if claudeErr := claudeResp.GetClaudeError(); claudeErr != nil && claudeErr.Type != "" {
		return nil, types.WithClaudeError(*claudeErr, http.StatusInternalServerError)
	}
	return &claudeResp, nil
}

// emitClaudeResponseAsStream synthesizes a Claude Messages SSE stream from a
// complete (non-streamed) response so Claude Code, which sends stream:true,
// receives a well-formed stream. Text and tool_use blocks are emitted; thinking
// blocks are omitted.
func emitClaudeResponseAsStream(c *gin.Context, resp *dto.ClaudeResponse, usage *dto.Usage, model string) {
	helper.SetEventStreamHeaders(c)
	w := c.Writer
	emit := func(eventType string, payload map[string]any) {
		payload["type"] = eventType
		data, err := common.Marshal(payload)
		if err != nil {
			return
		}
		_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, data)
		w.Flush()
	}

	msgID := resp.Id
	if msgID == "" {
		msgID = "msg_" + common.GetRandomString(24)
	}
	stopReason := resp.StopReason
	if stopReason == "" {
		stopReason = "end_turn"
	}

	emit("message_start", map[string]any{
		"message": map[string]any{
			"id":            msgID,
			"type":          "message",
			"role":          "assistant",
			"model":         model,
			"content":       []any{},
			"stop_reason":   nil,
			"stop_sequence": nil,
			"usage": map[string]any{
				"input_tokens":  usage.PromptTokens,
				"output_tokens": 0,
			},
		},
	})

	index := 0
	emittedAny := false
	for _, block := range resp.Content {
		switch block.Type {
		case "text", "":
			text := block.GetText()
			emit("content_block_start", map[string]any{
				"index":         index,
				"content_block": map[string]any{"type": "text", "text": ""},
			})
			if text != "" {
				emit("content_block_delta", map[string]any{
					"index": index,
					"delta": map[string]any{"type": "text_delta", "text": text},
				})
			}
			emit("content_block_stop", map[string]any{"index": index})
			index++
			emittedAny = true
		case "tool_use":
			inputJSON := "{}"
			if block.Input != nil {
				if b, err := common.Marshal(block.Input); err == nil {
					inputJSON = string(b)
				}
			}
			emit("content_block_start", map[string]any{
				"index": index,
				"content_block": map[string]any{
					"type":  "tool_use",
					"id":    block.Id,
					"name":  block.Name,
					"input": map[string]any{},
				},
			})
			emit("content_block_delta", map[string]any{
				"index": index,
				"delta": map[string]any{"type": "input_json_delta", "partial_json": inputJSON},
			})
			emit("content_block_stop", map[string]any{"index": index})
			index++
			emittedAny = true
		default:
			// thinking / other content blocks are omitted from the synthesized stream
		}
	}
	if !emittedAny {
		emit("content_block_start", map[string]any{
			"index":         0,
			"content_block": map[string]any{"type": "text", "text": ""},
		})
		emit("content_block_stop", map[string]any{"index": 0})
	}

	emit("message_delta", map[string]any{
		"delta": map[string]any{"stop_reason": stopReason, "stop_sequence": nil},
		"usage": map[string]any{"output_tokens": usage.CompletionTokens},
	})
	emit("message_stop", map[string]any{})
}
