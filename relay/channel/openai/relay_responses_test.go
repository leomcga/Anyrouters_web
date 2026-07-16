package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOaiResponsesHandlerPreservesCacheWriteTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	responseBody := `{
		"id": "resp_1",
		"output": [],
		"usage": {
			"input_tokens": 100,
			"output_tokens": 10,
			"total_tokens": 110,
			"input_tokens_details": {
				"cached_tokens": 5,
				"cache_write_tokens": 25
			}
		}
	}`
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(responseBody)),
	}

	usage, apiErr := OaiResponsesHandler(ctx, &relaycommon.RelayInfo{}, resp)

	require.Nil(t, apiErr)
	require.Equal(t, 100, usage.PromptTokens)
	require.Equal(t, 5, usage.PromptTokensDetails.CachedTokens)
	require.Equal(t, 25, usage.PromptTokensDetails.CachedCreationTokens)
}

func TestRecordResponsesOutputToolCallsCountsActualOutputItems(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: &relaycommon.BuildInToolInfo{},
				dto.BuildInToolFileSearch:       &relaycommon.BuildInToolInfo{},
			},
		},
	}

	recordResponsesOutputToolCalls(info, []dto.ResponsesOutput{
		{Type: "message"},
		{Type: dto.BuildInCallWebSearchCall},
		{Type: dto.BuildInCallFileSearchCall},
	})

	require.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
	require.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
}

func TestRecordResponsesOutputToolCallsIgnoresDeclaredToolsWithoutOutputCalls(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: &relaycommon.BuildInToolInfo{},
				dto.BuildInToolFileSearch:       &relaycommon.BuildInToolInfo{},
			},
		},
	}

	recordResponsesOutputToolCalls(info, []dto.ResponsesOutput{
		{Type: "message"},
	})

	require.Zero(t, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview].CallCount)
	require.Zero(t, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolFileSearch].CallCount)
}

func TestOaiResponsesStreamHandlerEmitsOfficialErrorOnAbruptUpstreamEOF(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body: io.NopCloser(strings.NewReader(
			"data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_partial\",\"status\":\"in_progress\",\"model\":\"gpt-5.6-sol\"},\"sequence_number\":7}\n",
		)),
	}
	info := &relaycommon.RelayInfo{
		IsStream: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gpt-5.6-sol",
		},
	}

	usage, apiErr := OaiResponsesStreamHandler(ctx, info, resp)

	require.Nil(t, usage)
	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCode("network_error"), apiErr.GetErrorCode())
	require.True(t, types.IsSkipRetryError(apiErr))
	require.True(t, ctx.GetBool("responses_stream_error_sent"))
	require.Contains(t, recorder.Body.String(), "event: error")
	require.Contains(t, recorder.Body.String(), `"type":"error"`)
	require.Contains(t, recorder.Body.String(), `"code":"network_error"`)
	require.Contains(t, recorder.Body.String(), `"sequence_number":8`)
	require.NotContains(t, recorder.Body.String(), `"type":"response.completed"`)
}

func TestOaiResponsesStreamHandlerAcceptsOfficialTerminalEventsWithoutDone(t *testing.T) {
	for _, eventType := range []string{"response.completed", "response.incomplete", "response.failed", "error"} {
		t.Run(eventType, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			body := `data: {"type":"` + eventType + `","response":{"id":"resp_terminal","status":"completed","model":"gpt-5.6-sol","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}},"sequence_number":9}` + "\n"
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}
			info := &relaycommon.RelayInfo{
				IsStream: true,
				ChannelMeta: &relaycommon.ChannelMeta{
					UpstreamModelName: "gpt-5.6-sol",
				},
			}

			usage, apiErr := OaiResponsesStreamHandler(ctx, info, resp)

			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			require.False(t, ctx.GetBool("responses_stream_error_sent"))
			require.Contains(t, recorder.Body.String(), `"type":"`+eventType+`"`)
			require.NotContains(t, recorder.Body.String(), `"code":"network_error"`)
		})
	}
}
