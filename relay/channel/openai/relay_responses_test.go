package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

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
