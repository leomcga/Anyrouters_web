package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestModelPriceHelperTieredUsesPreloadedRequestInput(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"tiered-test-model":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"tiered-test-model":"param(\"stream\") == true ? tier(\"stream\", p * 3) : tier(\"base\", p * 2)"}`,
	}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/api/channel/test/1", nil)
	req.Body = nil
	req.ContentLength = 0
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req
	ctx.Set("group", "default")

	info := &relaycommon.RelayInfo{
		OriginModelName: "tiered-test-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		RequestHeaders:  map[string]string{"Content-Type": "application/json"},
		BillingRequestInput: &billingexpr.RequestInput{
			Headers: map[string]string{"Content-Type": "application/json"},
			Body:    []byte(`{"stream":true}`),
		},
	}

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	require.Equal(t, 1500, priceData.QuotaToPreConsume)
	require.NotNil(t, info.TieredBillingSnapshot)
	require.Equal(t, "stream", info.TieredBillingSnapshot.EstimatedTier)
	require.Equal(t, billing_setting.BillingModeTieredExpr, info.TieredBillingSnapshot.BillingMode)
	require.Equal(t, common.QuotaPerUnit, info.TieredBillingSnapshot.QuotaPerUnit)
}

func newPriceHelperTestContext() *gin.Context {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("group", "default")
	return ctx
}

func TestModelPriceHelperRejectsUnpricedModelByDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ctx := newPriceHelperTestContext()
	info := &relaycommon.RelayInfo{
		OriginModelName: "definitely-unpriced-model",
		UserGroup:       "default",
		UsingGroup:      "default",
	}

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "价格尚未由管理员配置")
	require.Zero(t, priceData.QuotaToPreConsume)
	require.Zero(t, priceData.ModelRatio)
}

func TestModelPriceHelperAcceptsUnpricedModelWithoutPremiumPreconsume(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ctx := newPriceHelperTestContext()
	info := &relaycommon.RelayInfo{
		OriginModelName: "definitely-unpriced-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		UserSetting: dto.UserSetting{
			AcceptUnsetRatioModel: true,
		},
	}

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	require.False(t, priceData.UsePrice)
	require.Zero(t, priceData.ModelRatio)
	require.Zero(t, priceData.QuotaToPreConsume)
	require.Equal(t, priceData, info.PriceData)
}

func TestModelPriceHelperPerCallRejectsUnpricedModelByDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ctx := newPriceHelperTestContext()
	info := &relaycommon.RelayInfo{
		OriginModelName: "definitely-unpriced-task-model",
		UserGroup:       "default",
		UsingGroup:      "default",
	}

	priceData, err := ModelPriceHelperPerCall(ctx, info)
	require.Error(t, err)
	require.Contains(t, err.Error(), "价格尚未由管理员配置")
	require.Zero(t, priceData.Quota)
	require.Zero(t, priceData.ModelRatio)
}

func TestModelPriceHelperPerCallAcceptsUnpricedModelWithoutPremiumQuota(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ctx := newPriceHelperTestContext()
	info := &relaycommon.RelayInfo{
		OriginModelName: "definitely-unpriced-task-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		UserSetting: dto.UserSetting{
			AcceptUnsetRatioModel: true,
		},
	}

	priceData, err := ModelPriceHelperPerCall(ctx, info)
	require.NoError(t, err)
	require.False(t, priceData.UsePrice)
	require.Zero(t, priceData.ModelRatio)
	require.Zero(t, priceData.Quota)
}

func TestModelPriceHelperPerCallPreservesUnroundedTaskBaseQuota(t *testing.T) {
	gin.SetMode(gin.TestMode)

	savedGroupRatios := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(savedGroupRatios))
	})
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":0.333333}`))

	ctx := newPriceHelperTestContext()
	info := &relaycommon.RelayInfo{
		OriginModelName: "veo-3.1-fast-generate-001",
		UserGroup:       "default",
		UsingGroup:      "default",
	}

	priceData, err := ModelPriceHelperPerCall(ctx, info)
	require.NoError(t, err)
	require.InEpsilon(t, 16666.65, priceData.TaskBaseQuota, 0.000001)
	require.Equal(t, 16666, priceData.Quota)
}
