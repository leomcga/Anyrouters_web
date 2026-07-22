package common

import (
	"strings"

	"github.com/QuantumNous/new-api/constant"
)

const (
	// GPT56CacheWriteRatio is OpenAI's published GPT-5.6 cache-write price:
	// 1.25x the uncached input-token rate.
	GPT56CacheWriteRatio = 1.25

	azurePromptCacheMinTokens = 1024
	azurePromptCacheBlockSize = 128
)

func IsAzureGPT56(info *RelayInfo) bool {
	if info == nil || info.ChannelMeta == nil || info.ChannelType != constant.ChannelTypeAzure {
		return false
	}
	modelName := strings.ToLower(info.OriginModelName)
	return modelName == "gpt-5.6" || strings.HasPrefix(modelName, "gpt-5.6-")
}

// EstimateAzureGPT56CacheWriteTokens returns a conservative, auditable proxy
// only for Azure GPT-5.6 requests. Azure documents that these responses omit
// cache-write usage, while cache eligibility starts at 1,024 prompt tokens and
// advances in 128-token blocks.
func EstimateAzureGPT56CacheWriteTokens(info *RelayInfo, promptTokens, cachedTokens int) (int, bool) {
	if !IsAzureGPT56(info) {
		return 0, false
	}
	if promptTokens < azurePromptCacheMinTokens || cachedTokens < 0 || cachedTokens > promptTokens {
		return 0, false
	}

	uncachedTokens := promptTokens - cachedTokens
	estimatedTokens := uncachedTokens / azurePromptCacheBlockSize * azurePromptCacheBlockSize
	if estimatedTokens <= 0 {
		return 0, false
	}
	return estimatedTokens, true
}
