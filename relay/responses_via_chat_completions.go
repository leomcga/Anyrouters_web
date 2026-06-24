package relay

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relay/channel"
	codexchannel "github.com/QuantumNous/new-api/relay/channel/codex"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/openaicompat"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// adaptorSupportsResponsesNatively reports whether a channel can serve
// /v1/responses without conversion. Only the OpenAI and Codex adaptors speak
// the Responses API upstream; everything else (Claude/Bedrock, Gemini/Vertex,
// and OpenAI-compatible upstreams that only implement Chat Completions) is
// bridged via responsesViaChatCompletions.
func adaptorSupportsResponsesNatively(a channel.Adaptor) bool {
	switch a.(type) {
	case *openaichannel.Adaptor, *codexchannel.Adaptor:
		return true
	}
	return false
}

// responsesViaChatCompletions serves an OpenAI Responses API request against a
// channel that does not implement /v1/responses natively. It is the mirror of
// chatCompletionsViaResponses: convert Responses -> Chat Completions, run the
// fully-supported Chat path (RelayFormatOpenAI), capture the OpenAI-chat output
// and re-emit it in the Responses shape (streaming SSE or a single JSON object).
//
// Because the AWS/Bedrock and Gemini/Vertex handlers already render
// RelayFormatOpenAI output, this works for every such channel without
// per-provider code, and reuses their tool-call handling — which is what makes
// Codex (wire_api="responses") usable on Claude/Gemini.
func responsesViaChatCompletions(c *gin.Context, info *relaycommon.RelayInfo, adaptor channel.Adaptor, request *dto.OpenAIResponsesRequest) (*dto.Usage, *types.NewAPIError) {
	isStream := request.Stream != nil && *request.Stream

	chatReq, err := openaicompat.ResponsesRequestToChatCompletionsRequest(request)
	if err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	chatReq.Stream = &isStream
	if isStream {
		// Need usage in the bridged chat stream to build response.completed.
		chatReq.StreamOptions = &dto.StreamOptions{IncludeUsage: true}
	}

	// Switch the relay context to Chat Completions / OpenAI output for the
	// internal call, restoring the Responses context afterwards so billing and
	// logging see the original request.
	savedRelayMode := info.RelayMode
	savedRelayFormat := info.RelayFormat
	savedURLPath := info.RequestURLPath
	savedIsStream := info.IsStream
	savedShouldIncludeUsage := info.ShouldIncludeUsage
	defer func() {
		info.RelayMode = savedRelayMode
		info.RelayFormat = savedRelayFormat
		info.RequestURLPath = savedURLPath
		info.IsStream = savedIsStream
		info.ShouldIncludeUsage = savedShouldIncludeUsage
	}()
	info.RelayMode = relayconstant.RelayModeChatCompletions
	info.RelayFormat = types.RelayFormatOpenAI
	info.RequestURLPath = "/v1/chat/completions"
	info.IsStream = isStream
	info.ShouldIncludeUsage = isStream
	info.AppendRequestConversion(types.RelayFormatOpenAI)

	convertedRequest, err := adaptor.ConvertOpenAIRequest(c, info, chatReq)
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
	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			return nil, newAPIErrorFromParamOverride(err)
		}
	}

	body, size, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	defer closer.Close()
	jsonData = nil
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

	responseID := "resp_" + common.GetRandomString(24)
	createdAt := common.GetTimestamp()
	model := info.OriginModelName
	if model == "" {
		model = request.Model
	}

	realWriter := c.Writer

	if isStream {
		// Set the real SSE headers before swapping the writer; the bridged chat
		// handler's own SetEventStreamHeaders becomes a no-op (guarded by ctx key).
		helper.SetEventStreamHeaders(c)

		bridge := newResponsesStreamBridge(realWriter, responseID, model, createdAt)
		parser := &sseChatParser{onChunk: bridge.handleChatChunk}
		capture := &responsesCaptureWriter{
			ResponseWriter: realWriter,
			header:         http.Header{},
			onWrite:        parser.write,
		}
		c.Writer = capture
		usage, newAPIError := adaptor.DoResponse(c, httpResp, info)
		c.Writer = realWriter

		if newAPIError != nil {
			if !bridge.createdEmitted {
				// Nothing streamed yet — surface a clean error response.
				service.ResetStatusCode(newAPIError, statusCodeMappingStr)
				return nil, newAPIError
			}
			// Already mid-stream; we cannot switch to an error envelope cleanly.
			logger.LogError(c, "responses bridge stream error after start: "+newAPIError.Error())
		}
		usageDto := toUsageDto(usage)
		bridge.finish(usageDto)
		return usageDto, nil
	}

	// Non-streaming: buffer the chat JSON, then emit a single Responses object.
	var bodyBuf bytes.Buffer
	capture := &responsesCaptureWriter{
		ResponseWriter: realWriter,
		header:         http.Header{},
		onWrite:        func(p []byte) { bodyBuf.Write(p) },
	}
	c.Writer = capture
	usage, newAPIError := adaptor.DoResponse(c, httpResp, info)
	c.Writer = realWriter
	if newAPIError != nil {
		service.ResetStatusCode(newAPIError, statusCodeMappingStr)
		return nil, newAPIError
	}

	var chatResp dto.OpenAITextResponse
	if err := common.Unmarshal(bodyBuf.Bytes(), &chatResp); err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	respObj, usageDto := openaicompat.ChatCompletionsResponseToResponsesResponse(&chatResp, responseID, model, createdAt)
	if u := toUsageDto(usage); u != nil && u.TotalTokens > 0 {
		usageDto = u
		respObj["usage"] = openaicompat.BuildResponsesUsage(u)
	}
	c.JSON(http.StatusOK, respObj)
	return usageDto, nil
}

func toUsageDto(u any) *dto.Usage {
	if d, ok := u.(*dto.Usage); ok {
		return d
	}
	return nil
}

// responsesCaptureWriter is a gin.ResponseWriter that intercepts the bridged
// chat handler's body writes (routing them to onWrite) and swallows its header
// writes, so the real client response is produced solely by the bridge.
type responsesCaptureWriter struct {
	gin.ResponseWriter
	header  http.Header
	onWrite func([]byte)
}

func (w *responsesCaptureWriter) Header() http.Header { return w.header }

func (w *responsesCaptureWriter) Write(p []byte) (int, error) {
	w.onWrite(p)
	return len(p), nil
}

func (w *responsesCaptureWriter) WriteString(s string) (int, error) {
	w.onWrite([]byte(s))
	return len(s), nil
}

func (w *responsesCaptureWriter) WriteHeader(int) {}
func (w *responsesCaptureWriter) WriteHeaderNow()  {}
func (w *responsesCaptureWriter) Written() bool     { return false }
func (w *responsesCaptureWriter) Flush()            {}

// sseChatParser reassembles SSE events from arbitrary write boundaries and
// decodes each `data:` payload as a Chat Completions stream chunk.
type sseChatParser struct {
	buf     strings.Builder
	onChunk func(*dto.ChatCompletionsStreamResponse)
}

func (p *sseChatParser) write(b []byte) {
	p.buf.Write(b)
	s := p.buf.String()
	for {
		idx := strings.Index(s, "\n\n")
		if idx < 0 {
			break
		}
		p.handleEvent(s[:idx])
		s = s[idx+2:]
	}
	p.buf.Reset()
	p.buf.WriteString(s)
}

func (p *sseChatParser) handleEvent(event string) {
	for _, line := range strings.Split(event, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(payload, &chunk); err != nil {
			continue
		}
		p.onChunk(&chunk)
	}
}

// --- streaming bridge: Chat Completions chunks -> Responses SSE events ---

type bridgeToolState struct {
	itemID      string
	outputIndex int
	callID      string
	name        string
	args        strings.Builder
	open        bool
}

type responsesStreamBridge struct {
	w          gin.ResponseWriter
	responseID string
	model      string
	createdAt  int64

	seq            int
	createdEmitted bool

	// assistant message item
	msgOpen   bool
	msgIndex  int
	msgItemID string
	msgText   strings.Builder

	// function_call items keyed by chat tool_call index
	tools     map[int]*bridgeToolState
	toolOrder []int

	nextOutputIndex int
	usage           *dto.Usage
	completedItems  []map[string]any
}

func newResponsesStreamBridge(w gin.ResponseWriter, responseID, model string, createdAt int64) *responsesStreamBridge {
	return &responsesStreamBridge{
		w:          w,
		responseID: responseID,
		model:      model,
		createdAt:  createdAt,
		tools:      map[int]*bridgeToolState{},
	}
}

func (b *responsesStreamBridge) emit(eventType string, payload map[string]any) {
	payload["type"] = eventType
	payload["sequence_number"] = b.seq
	b.seq++
	data, err := common.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(b.w, "event: %s\ndata: %s\n\n", eventType, data)
	b.w.Flush()
}

func (b *responsesStreamBridge) ensureCreated() {
	if b.createdEmitted {
		return
	}
	b.createdEmitted = true
	resp := openaicompat.BuildResponsesResponseObject(b.responseID, b.model, b.createdAt, "in_progress", nil, nil)
	b.emit("response.created", map[string]any{"response": resp})
	b.emit("response.in_progress", map[string]any{"response": resp})
}

func (b *responsesStreamBridge) openMessage() {
	b.msgIndex = b.nextOutputIndex
	b.nextOutputIndex++
	b.msgItemID = openaicompat.ResponsesItemID(b.responseID, b.msgIndex)
	b.msgOpen = true
	b.emit("response.output_item.added", map[string]any{
		"output_index": b.msgIndex,
		"item":         openaicompat.BuildResponsesMessageItem(b.msgItemID, "", "in_progress"),
	})
	b.emit("response.content_part.added", map[string]any{
		"item_id":       b.msgItemID,
		"output_index":  b.msgIndex,
		"content_index": 0,
		"part":          openaicompat.BuildResponsesOutputTextPart(""),
	})
}

func (b *responsesStreamBridge) closeMessage() {
	if !b.msgOpen {
		return
	}
	text := b.msgText.String()
	b.emit("response.output_text.done", map[string]any{
		"item_id":       b.msgItemID,
		"output_index":  b.msgIndex,
		"content_index": 0,
		"text":          text,
	})
	b.emit("response.content_part.done", map[string]any{
		"item_id":       b.msgItemID,
		"output_index":  b.msgIndex,
		"content_index": 0,
		"part":          openaicompat.BuildResponsesOutputTextPart(text),
	})
	item := openaicompat.BuildResponsesMessageItem(b.msgItemID, text, "completed")
	b.emit("response.output_item.done", map[string]any{
		"output_index": b.msgIndex,
		"item":         item,
	})
	b.completedItems = append(b.completedItems, item)
	b.msgOpen = false
}

func (b *responsesStreamBridge) handleChatChunk(chunk *dto.ChatCompletionsStreamResponse) {
	b.ensureCreated()
	if chunk == nil {
		return
	}
	if chunk.Usage != nil {
		b.usage = chunk.Usage
	}
	if len(chunk.Choices) == 0 {
		return
	}
	delta := chunk.Choices[0].Delta

	if content := delta.GetContentString(); content != "" {
		if !b.msgOpen {
			b.openMessage()
		}
		b.msgText.WriteString(content)
		b.emit("response.output_text.delta", map[string]any{
			"item_id":       b.msgItemID,
			"output_index":  b.msgIndex,
			"content_index": 0,
			"delta":         content,
		})
	}

	if len(delta.ToolCalls) > 0 {
		// Tool calls follow text in the Claude/Bedrock/Gemini stream; finish the
		// open message item before opening function_call items.
		b.closeMessage()
		for _, tc := range delta.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			ts := b.tools[idx]
			if ts == nil {
				ts = &bridgeToolState{
					outputIndex: b.nextOutputIndex,
					itemID:      openaicompat.ResponsesItemID(b.responseID, b.nextOutputIndex),
					callID:      tc.ID,
					name:        tc.Function.Name,
					open:        true,
				}
				b.nextOutputIndex++
				b.tools[idx] = ts
				b.toolOrder = append(b.toolOrder, idx)
				b.emit("response.output_item.added", map[string]any{
					"output_index": ts.outputIndex,
					"item":         openaicompat.BuildResponsesFunctionCallItem(ts.itemID, ts.callID, ts.name, "", "in_progress"),
				})
			} else {
				if ts.callID == "" && tc.ID != "" {
					ts.callID = tc.ID
				}
				if ts.name == "" && tc.Function.Name != "" {
					ts.name = tc.Function.Name
				}
			}
			if args := tc.Function.Arguments; args != "" {
				ts.args.WriteString(args)
				b.emit("response.function_call_arguments.delta", map[string]any{
					"item_id":      ts.itemID,
					"output_index": ts.outputIndex,
					"delta":        args,
				})
			}
		}
	}
}

func (b *responsesStreamBridge) finish(usage *dto.Usage) {
	b.ensureCreated()
	if usage != nil {
		b.usage = usage
	}
	b.closeMessage()
	for _, idx := range b.toolOrder {
		ts := b.tools[idx]
		if ts == nil || !ts.open {
			continue
		}
		args := ts.args.String()
		b.emit("response.function_call_arguments.done", map[string]any{
			"item_id":      ts.itemID,
			"output_index": ts.outputIndex,
			"arguments":    args,
		})
		item := openaicompat.BuildResponsesFunctionCallItem(ts.itemID, ts.callID, ts.name, args, "completed")
		b.emit("response.output_item.done", map[string]any{
			"output_index": ts.outputIndex,
			"item":         item,
		})
		b.completedItems = append(b.completedItems, item)
		ts.open = false
	}
	resp := openaicompat.BuildResponsesResponseObject(b.responseID, b.model, b.createdAt, "completed", b.completedItems, b.usage)
	b.emit("response.completed", map[string]any{"response": resp})
}
