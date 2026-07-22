package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"

	"github.com/stretchr/testify/require"
)

func TestEstimateAzureGPT56CacheWriteTokens(t *testing.T) {
	azureGPT56 := &RelayInfo{
		ChannelMeta:     &ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		OriginModelName: "gpt-5.6-sol",
	}

	tests := []struct {
		name         string
		info         *RelayInfo
		promptTokens int
		cachedTokens int
		wantTokens   int
		wantOK       bool
	}{
		{
			name:         "full eligible miss",
			info:         azureGPT56,
			promptTokens: 1536,
			wantTokens:   1536,
			wantOK:       true,
		},
		{
			name:         "partial hit estimates only the uncached suffix",
			info:         azureGPT56,
			promptTokens: 2048,
			cachedTokens: 1024,
			wantTokens:   1024,
			wantOK:       true,
		},
		{
			name:         "rounds down incomplete cache blocks",
			info:         azureGPT56,
			promptTokens: 1500,
			cachedTokens: 1024,
			wantTokens:   384,
			wantOK:       true,
		},
		{
			name:         "below Azure cache eligibility threshold",
			info:         azureGPT56,
			promptTokens: 1000,
		},
		{
			name: "other provider is never inferred",
			info: &RelayInfo{
				ChannelMeta:     &ChannelMeta{ChannelType: constant.ChannelTypeOpenAI},
				OriginModelName: "gpt-5.6-sol",
			},
			promptTokens: 2048,
		},
		{
			name: "older Azure model is never inferred",
			info: &RelayInfo{
				ChannelMeta:     &ChannelMeta{ChannelType: constant.ChannelTypeAzure},
				OriginModelName: "gpt-5.5",
			},
			promptTokens: 2048,
		},
		{
			name:         "invalid cached count cannot create a charge",
			info:         azureGPT56,
			promptTokens: 1024,
			cachedTokens: 2048,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotTokens, gotOK := EstimateAzureGPT56CacheWriteTokens(tt.info, tt.promptTokens, tt.cachedTokens)
			require.Equal(t, tt.wantTokens, gotTokens)
			require.Equal(t, tt.wantOK, gotOK)
		})
	}
}
