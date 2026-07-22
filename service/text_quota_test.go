package service

import (
	"math"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestCalculateTextQuotaSummaryUnifiedForClaudeSemantic(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	usage := &dto.Usage{
		PromptTokens:     1000,
		CompletionTokens: 200,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         100,
			CachedCreationTokens: 50,
		},
		ClaudeCacheCreation5mTokens: 10,
		ClaudeCacheCreation1hTokens: 20,
	}

	priceData := types.PriceData{
		ModelRatio:           1,
		CompletionRatio:      2,
		CacheRatio:           0.1,
		CacheCreationRatio:   1.25,
		CacheCreation5mRatio: 1.25,
		CacheCreation1hRatio: 2,
		GroupRatioInfo: types.GroupRatioInfo{
			GroupRatio: 1,
		},
	}

	chatRelayInfo := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "claude-3-7-sonnet",
		PriceData:               priceData,
		StartTime:               time.Now(),
	}
	messageRelayInfo := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatClaude,
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "claude-3-7-sonnet",
		PriceData:               priceData,
		StartTime:               time.Now(),
	}

	chatSummary := calculateTextQuotaSummary(ctx, chatRelayInfo, usage)
	messageSummary := calculateTextQuotaSummary(ctx, messageRelayInfo, usage)

	require.Equal(t, messageSummary.Quota, chatSummary.Quota)
	require.Equal(t, messageSummary.CacheCreationTokens5m, chatSummary.CacheCreationTokens5m)
	require.Equal(t, messageSummary.CacheCreationTokens1h, chatSummary.CacheCreationTokens1h)
	require.True(t, chatSummary.IsClaudeUsageSemantic)
	require.Equal(t, 1488, chatSummary.Quota)
}

func TestCalculateTextQuotaSummaryUsesSplitClaudeCacheCreationRatios(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:           1,
			CompletionRatio:      1,
			CacheRatio:           0,
			CacheCreationRatio:   1,
			CacheCreation5mRatio: 2,
			CacheCreation1hRatio: 3,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 1,
			},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 0,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedCreationTokens: 10,
		},
		ClaudeCacheCreation5mTokens: 2,
		ClaudeCacheCreation1hTokens: 3,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// 100 + remaining(5)*1 + 2*2 + 3*3 = 118
	require.Equal(t, 118, summary.Quota)
}

func TestCalculateTextQuotaSummaryUsesAnthropicUsageSemanticFromUpstreamUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatOpenAI,
		OriginModelName: "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:           1,
			CompletionRatio:      2,
			CacheRatio:           0.1,
			CacheCreationRatio:   1.25,
			CacheCreation5mRatio: 1.25,
			CacheCreation1hRatio: 2,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 1,
			},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     1000,
		CompletionTokens: 200,
		UsageSemantic:    "anthropic",
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         100,
			CachedCreationTokens: 50,
		},
		ClaudeCacheCreation5mTokens: 10,
		ClaudeCacheCreation1hTokens: 20,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	require.True(t, summary.IsClaudeUsageSemantic)
	require.Equal(t, "anthropic", summary.UsageSemantic)
	require.Equal(t, 1488, summary.Quota)
}

func TestCacheWriteTokensTotal(t *testing.T) {
	t.Run("split cache creation", func(t *testing.T) {
		summary := textQuotaSummary{
			CacheCreationTokens:   50,
			CacheCreationTokens5m: 10,
			CacheCreationTokens1h: 20,
		}
		require.Equal(t, 50, cacheWriteTokensTotal(summary))
	})

	t.Run("legacy cache creation", func(t *testing.T) {
		summary := textQuotaSummary{CacheCreationTokens: 50}
		require.Equal(t, 50, cacheWriteTokensTotal(summary))
	})

	t.Run("split cache creation without aggregate remainder", func(t *testing.T) {
		summary := textQuotaSummary{
			CacheCreationTokens5m: 10,
			CacheCreationTokens1h: 20,
		}
		require.Equal(t, 30, cacheWriteTokensTotal(summary))
	})
}

func TestCalculateTextQuotaSummaryHandlesLegacyClaudeDerivedOpenAIUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatOpenAI,
		OriginModelName: "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:           1,
			CompletionRatio:      5,
			CacheRatio:           0.1,
			CacheCreationRatio:   1.25,
			CacheCreation5mRatio: 1.25,
			CacheCreation1hRatio: 2,
			GroupRatioInfo:       types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     62,
		CompletionTokens: 95,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 3544,
		},
		ClaudeCacheCreation5mTokens: 586,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// 62 + 3544*0.1 + 586*1.25 + 95*5 = 1624.9 => 1624
	require.Equal(t, 1624, summary.Quota)
}

func TestCalculateTextQuotaSummarySeparatesOpenRouterCacheReadFromPromptBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "openai/gpt-4.1",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeOpenRouter,
		},
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     2604,
		CompletionTokens: 383,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 2432,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// OpenRouter OpenAI-format display keeps prompt_tokens as total input,
	// but billing still separates normal input from cache read tokens.
	// quota = (2604 - 2432) + 2432*0.1 + 383 = 798.2 => 798
	require.Equal(t, 2604, summary.PromptTokens)
	require.Equal(t, 798, summary.Quota)
}

func TestGPT56TextQuotaAppliesIndependentGroupDiscounts(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		modelName  string
		modelRatio float64
		groupRatio float64
		wantQuota  int
	}{
		{modelName: "gpt-5.6-sol", modelRatio: 2.5, groupRatio: 0.61, wantQuota: 2166},
		{modelName: "gpt-5.6-terra", modelRatio: 1.25, groupRatio: 0.62, wantQuota: 1101},
		{modelName: "gpt-5.6-luna", modelRatio: 0.5, groupRatio: 0.63, wantQuota: 447},
	}

	for _, tt := range tests {
		t.Run(tt.modelName, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			relayInfo := &relaycommon.RelayInfo{
				OriginModelName: tt.modelName,
				PriceData: types.PriceData{
					ModelRatio:      tt.modelRatio,
					CompletionRatio: 6,
					CacheRatio:      0.1,
					GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: tt.groupRatio},
				},
				StartTime: time.Now(),
			}
			usage := &dto.Usage{
				PromptTokens:     1000,
				CompletionTokens: 100,
				PromptTokensDetails: dto.InputTokenDetails{
					CachedTokens: 200,
				},
			}

			summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

			// Weighted tokens = (1000-200) + 200*0.1 + 100*6 = 1420.
			// The model ratio and group discount must each be applied once.
			require.Equal(t, tt.wantQuota, summary.Quota)
			require.Equal(t, tt.groupRatio, summary.GroupRatio)
			require.Equal(t, 6.0, summary.CompletionRatio)
			require.Equal(t, 0.1, summary.CacheRatio)
		})
	}
}

func TestGPT56TextQuotaBillsCacheWriteTokensAtCreationRatio(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.6-sol",
		PriceData: types.PriceData{
			ModelRatio:         2.5,
			CompletionRatio:    6,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 0.6,
			},
		},
		StartTime: time.Now(),
	}
	var usage dto.Usage
	require.NoError(t, common.Unmarshal([]byte(`{
		"prompt_tokens": 1000,
		"prompt_tokens_details": {
			"cache_write_tokens": 200
		}
	}`), &usage))

	summary := calculateTextQuotaSummary(ctx, relayInfo, &usage)

	// Weighted prompt = (1000 - 200) + 200*1.25 = 1050.
	// 1050 * 2.5 model ratio * 0.6 group discount = 1575.
	require.Equal(t, 1575, summary.Quota)
	require.Equal(t, 200, summary.CacheCreationTokens)
}

func TestGPT56TextQuotaClampsOverlappingCacheUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "gpt-5.6-sol",
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}
	usage := &dto.Usage{
		PromptTokens: 100,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:     80,
			CacheWriteTokens: 50,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// The two explicit cache counters overlap the prompt total. The ordinary
	// input remainder is clamped to zero instead of becoming a negative credit.
	// 80*0.1 cache reads + 50*1.25 cache writes = 70.5, rounded to 71 quota.
	require.Equal(t, 71, summary.Quota)
}

func TestAzureGPT56TextQuotaEstimatesUnreportedCacheWriteTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeAzure,
		},
		OriginModelName: "gpt-5.6-sol",
		PriceData: types.PriceData{
			ModelRatio:         2.5,
			CompletionRatio:    6,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo: types.GroupRatioInfo{
				GroupRatio: 0.7,
			},
		},
		StartTime: time.Now(),
	}
	usage := &dto.Usage{
		PromptTokens:     1536,
		CompletionTokens: 100,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 512,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// Azure omits GPT-5.6 cache-write usage. The 1024-token uncached suffix is
	// reclassified from ordinary input (1x) to OpenAI's official cache-write
	// rate (1.25x), so only the 0.25x difference is added.
	require.Equal(t, 1024, summary.CacheCreationTokens)
	require.True(t, summary.CacheCreationEstimated)
	require.Equal(t, 1.25, summary.CacheCreationRatio)
	// Weighted tokens = 512*0.1 + 1024*1.25 + 100*6 = 1931.2;
	// applying the $5/M model ratio and the 70% group price yields 3380 quota
	// after the billing system's standard half-away-from-zero rounding.
	require.Equal(t, 3380, summary.Quota)
}

func TestAzureGPT56TextQuotaPrefersReportedCacheWriteTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		OriginModelName: "gpt-5.6-sol",
		PriceData: types.PriceData{
			ModelRatio:         2.5,
			CompletionRatio:    6,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 0.7},
		},
		StartTime: time.Now(),
	}
	usage := &dto.Usage{
		PromptTokens: 1536,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:     512,
			CacheWriteTokens: 256,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	require.Equal(t, 256, summary.CacheCreationTokens)
	require.False(t, summary.CacheCreationEstimated)
}

func TestAzureGPT56TextQuotaDoesNotEstimateBelowCacheThreshold(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		OriginModelName: "gpt-5.6-sol",
		PriceData: types.PriceData{
			ModelRatio:         2.5,
			CompletionRatio:    6,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 0.7},
		},
		StartTime: time.Now(),
	}
	usage := &dto.Usage{PromptTokens: 1000}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	require.Zero(t, summary.CacheCreationTokens)
	require.False(t, summary.CacheCreationEstimated)
}

func TestAzureGPT56CacheWriteUnreportedAuditMarker(t *testing.T) {
	relayInfo := &relaycommon.RelayInfo{
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		OriginModelName: "gpt-5.6-sol",
	}

	require.True(t, isAzureGPT56CacheWriteUnreported(relayInfo, &dto.Usage{}))
	require.False(t, isAzureGPT56CacheWriteUnreported(relayInfo, &dto.Usage{
		PromptTokensDetails: dto.InputTokenDetails{CacheWriteTokens: 12},
	}))

	relayInfo.ChannelType = constant.ChannelTypeOpenAI
	require.False(t, isAzureGPT56CacheWriteUnreported(relayInfo, &dto.Usage{}))
}

func TestCalculateTextQuotaSummarySeparatesOpenRouterCacheCreationFromPromptBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "openai/gpt-4.1",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeOpenRouter,
		},
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     2604,
		CompletionTokens: 383,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedCreationTokens: 100,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// prompt_tokens is still logged as total input, but cache creation is billed separately.
	// quota = (2604 - 100) + 100*1.25 + 383 = 3012
	require.Equal(t, 2604, summary.PromptTokens)
	require.Equal(t, 3012, summary.Quota)
}

func TestCalculateTextQuotaSummaryKeepsPrePRClaudeOpenRouterBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{
		FinalRequestRelayFormat: types.RelayFormatClaude,
		OriginModelName:         "anthropic/claude-3.7-sonnet",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: constant.ChannelTypeOpenRouter,
		},
		PriceData: types.PriceData{
			ModelRatio:         1,
			CompletionRatio:    1,
			CacheRatio:         0.1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     2604,
		CompletionTokens: 383,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 2432,
		},
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// Pre-PR PostClaudeConsumeQuota behavior for OpenRouter:
	// prompt = 2604 - 2432 = 172
	// quota = 172 + 2432*0.1 + 383 = 798.2 => 798
	require.True(t, summary.IsClaudeUsageSemantic)
	require.Equal(t, 172, summary.PromptTokens)
	require.Equal(t, 798, summary.Quota)
}

func TestComposeTieredTextQuotaKeepsToolCallSurcharges(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set("image_generation_call", true)
	ctx.Set("image_generation_call_quality", "low")
	ctx.Set("image_generation_call_size", "1024x1024")

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "o1",
		PriceData: types.PriceData{
			ModelRatio:      1,
			CompletionRatio: 1,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
		},
		ResponsesUsageInfo: &relaycommon.ResponsesUsageInfo{
			BuiltInTools: map[string]*relaycommon.BuildInToolInfo{
				dto.BuildInToolWebSearchPreview: &relaycommon.BuildInToolInfo{
					CallCount: 1,
				},
				dto.BuildInToolFileSearch: &relaycommon.BuildInToolInfo{
					CallCount: 2,
				},
			},
		},
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:               "tiered_expr",
			GroupRatio:                1,
			EstimatedQuotaBeforeGroup: 1000,
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 50,
		TotalTokens:      150,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)
	quota := composeTieredTextQuota(relayInfo, summary, 1000, &billingexpr.TieredResult{
		ActualQuotaBeforeGroup: 1000,
		ActualQuotaAfterGroup:  1000,
	})

	require.Equal(t, int64(13000), summary.ToolCallSurchargeQuota.Round(0).IntPart())
	require.Equal(t, 14000, quota)
}

func TestComposeTieredTextQuotaFallbackKeepsToolCallSurcharges(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set("claude_web_search_requests", 2)

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:      1,
			CompletionRatio: 1,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1.25},
		},
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:               "tiered_expr",
			GroupRatio:                1.25,
			EstimatedQuotaBeforeGroup: 1000,
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 50,
		TotalTokens:      150,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)
	quota := composeTieredTextQuota(relayInfo, summary, 1250, nil)

	require.Equal(t, int64(12500), summary.ToolCallSurchargeQuota.Round(0).IntPart())
	require.Equal(t, 13750, quota)
}

func TestCalculateTextQuotaSummaryKeepsToolSurchargeWhenTokenUsageIsZero(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set("image_generation_call", true)
	ctx.Set("image_generation_call_quality", "low")
	ctx.Set("image_generation_call_size", "1024x1024")

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "gpt-4.1",
		PriceData: types.PriceData{
			ModelRatio:      1,
			CompletionRatio: 4,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1},
		},
		StartTime: time.Now(),
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, &dto.Usage{})

	require.Equal(t, 5500, summary.Quota)
	require.Equal(t, int64(5500), summary.ToolCallSurchargeQuota.Round(0).IntPart())
}

func TestComposeTieredTextQuotaErrorFallbackUsesPreConsumedQuota(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set("claude_web_search_requests", 2)

	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "claude-3-7-sonnet",
		PriceData: types.PriceData{
			ModelRatio:      1,
			CompletionRatio: 1,
			GroupRatioInfo:  types.GroupRatioInfo{GroupRatio: 1.25},
		},
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:               "tiered_expr",
			GroupRatio:                1.25,
			EstimatedQuotaBeforeGroup: 1000,
		},
		StartTime: time.Now(),
	}

	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 50,
		TotalTokens:      150,
	}

	summary := calculateTextQuotaSummary(ctx, relayInfo, usage)

	// tieredResult=nil simulates a settlement error where TryTieredSettle
	// falls back to FinalPreConsumedQuota (2000), which differs from
	// EstimatedQuotaBeforeGroup * GroupRatio (1250).
	preConsumedFallback := 2000
	quota := composeTieredTextQuota(relayInfo, summary, preConsumedFallback, nil)

	require.Equal(t, int64(12500), summary.ToolCallSurchargeQuota.Round(0).IntPart())
	require.Equal(t, 14500, quota)
}

// TestTryTieredSettleRecordsClampOnOverflow guards that an oversized tiered
// settlement both saturates the quota and records the clamp on RelayInfo, so
// every consume path (text, audio, WSS) can surface it under admin_info.
func TestTryTieredSettleRecordsClampOnOverflow(t *testing.T) {
	// exprOutput = p * 1e9; quotaBeforeGroup = p*1e9 / 1e6 * 5e5 far exceeds
	// MaxInt32 and must saturate.
	exprStr := `tier("base", p * 1000000000)`
	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "overflow-model",
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:  "tiered_expr",
			ExprString:   exprStr,
			ExprHash:     billingexpr.ExprHashString(exprStr),
			GroupRatio:   1,
			QuotaPerUnit: 500_000,
		},
	}

	ok, quota, result := TryTieredSettle(relayInfo, billingexpr.TokenParams{P: 1_000_000_000})

	require.True(t, ok)
	require.NotNil(t, result)
	require.Equal(t, math.MaxInt32, quota, "oversized settlement must clamp, never wrap negative")
	require.NotNil(t, relayInfo.QuotaClamp, "clamp must be recorded on RelayInfo for admin auditing")
	require.Equal(t, common.QuotaClampOverflow, relayInfo.QuotaClamp.Kind)
}

// TestTryTieredSettleNoClampInRange confirms an in-range settlement leaves
// RelayInfo.QuotaClamp nil.
func TestTryTieredSettleNoClampInRange(t *testing.T) {
	exprStr := `tier("base", p * 2 + c * 10)`
	relayInfo := &relaycommon.RelayInfo{
		OriginModelName: "in-range-model",
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:  "tiered_expr",
			ExprString:   exprStr,
			ExprHash:     billingexpr.ExprHashString(exprStr),
			GroupRatio:   1,
			QuotaPerUnit: 500_000,
		},
	}

	ok, _, result := TryTieredSettle(relayInfo, billingexpr.TokenParams{P: 1000, C: 500})

	require.True(t, ok)
	require.NotNil(t, result)
	require.Nil(t, relayInfo.QuotaClamp, "in-range settlement must not record a clamp")
}
