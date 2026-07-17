package aws

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestConvertOpenAIRequestPreservesClaudeReasoningEffort(t *testing.T) {
	adaptor := &Adaptor{}
	info := &common.RelayInfo{ChannelMeta: &common.ChannelMeta{}}
	request := &dto.GeneralOpenAIRequest{
		Model:           "claude-opus-4-6",
		ReasoningEffort: "max",
		Messages: []dto.Message{{
			Role:    "user",
			Content: "hello",
		}},
	}

	converted, err := adaptor.ConvertOpenAIRequest(nil, info, request)
	require.NoError(t, err)
	require.Equal(t, "max", info.ReasoningEffort)

	claudeRequest, ok := converted.(*dto.ClaudeRequest)
	require.True(t, ok)
	require.NotNil(t, claudeRequest.Thinking)
	require.Equal(t, "adaptive", claudeRequest.Thinking.Type)
	require.JSONEq(t, `{"effort":"max"}`, string(claudeRequest.OutputConfig))
}
