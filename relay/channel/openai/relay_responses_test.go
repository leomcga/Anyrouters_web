package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
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
