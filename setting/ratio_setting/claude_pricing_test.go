package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func resetRatioMapsForTest(t *testing.T) {
	t.Helper()

	modelPriceMap.Clear()
	modelRatioMap.Clear()
	completionRatioMap.Clear()
	cacheRatioMap.Clear()
	createCacheRatioMap.Clear()
	imageRatioMap.Clear()
	audioRatioMap.Clear()
	audioCompletionRatioMap.Clear()

	InitRatioSettings()
}

func TestClaudeSonnet46HasDefaultTokenAndCachePricing(t *testing.T) {
	resetRatioMapsForTest(t)

	modelRatio, ok, matchName := GetModelRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, "claude-sonnet-4-6", matchName)
	require.Equal(t, 1.5, modelRatio)
	require.Equal(t, 5.0, GetCompletionRatio("claude-sonnet-4-6"))

	cacheRatio, ok := GetCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 0.1, cacheRatio)

	createCacheRatio, ok := GetCreateCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.25, createCacheRatio)
}

func TestRatioOptionUpdatesMergeCompatibilityDefaultsWithoutOverridingCustomValues(t *testing.T) {
	resetRatioMapsForTest(t)

	require.NoError(t, UpdateModelRatioByJSONString(`{"custom-model":2}`))
	modelRatio, ok, _ := GetModelRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.5, modelRatio)
	customRatio, ok, _ := GetModelRatio("custom-model")
	require.True(t, ok)
	require.Equal(t, 2.0, customRatio)

	require.NoError(t, UpdateCacheRatioByJSONString(`{"custom-model":0.25}`))
	cacheRatio, ok := GetCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 0.1, cacheRatio)
	customCacheRatio, ok := GetCacheRatio("custom-model")
	require.True(t, ok)
	require.Equal(t, 0.25, customCacheRatio)

	require.NoError(t, UpdateCreateCacheRatioByJSONString(`{"custom-model":1.5}`))
	createCacheRatio, ok := GetCreateCacheRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.25, createCacheRatio)
	customCreateCacheRatio, ok := GetCreateCacheRatio("custom-model")
	require.True(t, ok)
	require.Equal(t, 1.5, customCreateCacheRatio)

	require.NoError(t, UpdateModelRatioByJSONString(`{"claude-sonnet-4-6":1.8}`))
	customClaudeRatio, ok, _ := GetModelRatio("claude-sonnet-4-6")
	require.True(t, ok)
	require.Equal(t, 1.8, customClaudeRatio)
}

func TestOpenAICompletionRatiosMatchDefaultPricing(t *testing.T) {
	resetRatioMapsForTest(t)

	require.Equal(t, 4.0, GetCompletionRatio("gpt-4.1"))
	require.Equal(t, 4.0, GetCompletionRatio("gpt-4.1-mini"))
	require.Equal(t, 4.0, GetCompletionRatio("gpt-4.1-nano"))
	require.Equal(t, 4.0, GetCompletionRatio("o4-mini"))
	require.Equal(t, 4.0, GetCompletionRatio("o4-mini-deep-research"))
	require.Equal(t, 8.0, GetCompletionRatio("gpt-5"))
}
