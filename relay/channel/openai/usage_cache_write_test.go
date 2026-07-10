package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestApplyUsagePostProcessingNormalizesChatCacheWriteTokens(t *testing.T) {
	usage := &dto.Usage{
		PromptTokensDetails: dto.InputTokenDetails{
			CacheWriteTokens: 25,
		},
	}

	applyUsagePostProcessing(&relaycommon.RelayInfo{}, usage, nil)

	require.Equal(t, 25, usage.PromptTokensDetails.CachedCreationTokens)
}

func TestCopyInputTokenDetailsPreservesResponsesCacheWriteTokens(t *testing.T) {
	target := dto.InputTokenDetails{}
	source := &dto.InputTokenDetails{
		CachedTokens:     10,
		CacheWriteTokens: 25,
		ImageTokens:      3,
	}

	copyInputTokenDetails(&target, source)

	require.Equal(t, 10, target.CachedTokens)
	require.Equal(t, 25, target.CachedCreationTokens)
	require.Equal(t, 3, target.ImageTokens)
}
