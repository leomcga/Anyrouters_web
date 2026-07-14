package openaicompat

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/samber/lo"
	"github.com/stretchr/testify/require"
)

func TestChatCompletionsRequestToResponsesRequestGPT5DefaultOutputTokens(t *testing.T) {
	oldDefault := common.TrafficDefaultOutputTokens
	common.TrafficDefaultOutputTokens = 8192
	t.Cleanup(func() {
		common.TrafficDefaultOutputTokens = oldDefault
	})

	req := &dto.GeneralOpenAIRequest{
		Model:    "gpt-5.5",
		Messages: []dto.Message{{Role: "user", Content: "long answer"}},
	}

	got, err := ChatCompletionsRequestToResponsesRequest(req)

	require.NoError(t, err)
	require.NotNil(t, got.MaxOutputTokens)
	require.EqualValues(t, common.GetTrafficControlConfig().DefaultOutputTokens, *got.MaxOutputTokens)
}

func TestChatCompletionsRequestToResponsesRequestPreservesExplicitOutputLimit(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model:               "gpt-5.5",
		Messages:            []dto.Message{{Role: "user", Content: "long answer"}},
		MaxCompletionTokens: lo.ToPtr(uint(12000)),
	}

	got, err := ChatCompletionsRequestToResponsesRequest(req)

	require.NoError(t, err)
	require.EqualValues(t, 12000, *got.MaxOutputTokens)
}

func TestChatCompletionsRequestToResponsesRequestPreservesExplicitZero(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model:               "gpt-5.5",
		Messages:            []dto.Message{{Role: "user", Content: "long answer"}},
		MaxCompletionTokens: lo.ToPtr(uint(0)),
	}

	got, err := ChatCompletionsRequestToResponsesRequest(req)

	require.NoError(t, err)
	require.NotNil(t, got.MaxOutputTokens)
	require.Zero(t, *got.MaxOutputTokens)
}
