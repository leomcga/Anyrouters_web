package dto

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestInputTokenDetailsRecognizesCacheWriteTokens(t *testing.T) {
	var usage Usage
	require.NoError(t, common.Unmarshal([]byte(`{
		"prompt_tokens": 100,
		"prompt_tokens_details": {
			"cache_write_tokens": 24
		}
	}`), &usage))

	require.Equal(t, 24, usage.PromptTokensDetails.EffectiveCacheCreationTokens())
}

func TestInputTokenDetailsDoesNotDoubleCountCacheWriteAliases(t *testing.T) {
	details := InputTokenDetails{
		CachedCreationTokens: 40,
		CacheWriteTokens:     24,
	}

	require.Equal(t, 24, details.EffectiveCacheCreationTokens())
}
