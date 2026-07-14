package helper

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGPT56PriceDataUsesPerGroupDiscount(t *testing.T) {
	ratio_setting.InitRatioSettings()

	oldGroupRatio := ratio_setting.GroupRatio2JSONString()
	oldGroupModelRatio := ratio_setting.GroupModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroupRatio))
		require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(oldGroupModelRatio))
	})

	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":1,"btob":1,"b2b_16":1}`,
	))
	require.NoError(t, ratio_setting.UpdateGroupModelRatioByJSONString(
		`{
			"default":{"gpt-5.6-sol":0.7,"gpt-5.6-terra":0.7,"gpt-5.6-luna":0.7},
			"btob":{"gpt-5.6-sol":0.6,"gpt-5.6-terra":0.6,"gpt-5.6-luna":0.6},
			"b2b_16":{"gpt-5.6-sol":0.61,"gpt-5.6-terra":0.62,"gpt-5.6-luna":0.63}
		}`,
	))

	modelRatios := map[string]float64{
		"gpt-5.6-sol":   2.5,
		"gpt-5.6-terra": 1.25,
		"gpt-5.6-luna":  0.5,
	}
	groupDiscounts := map[string]map[string]float64{
		"default": {"gpt-5.6-sol": 0.7, "gpt-5.6-terra": 0.7, "gpt-5.6-luna": 0.7},
		"btob":    {"gpt-5.6-sol": 0.6, "gpt-5.6-terra": 0.6, "gpt-5.6-luna": 0.6},
		"b2b_16":  {"gpt-5.6-sol": 0.61, "gpt-5.6-terra": 0.62, "gpt-5.6-luna": 0.63},
	}

	for group, discounts := range groupDiscounts {
		for modelName, discount := range discounts {
			t.Run(group+"/"+modelName, func(t *testing.T) {
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				info := &common.RelayInfo{
					UserGroup:       group,
					UsingGroup:      group,
					OriginModelName: modelName,
				}

				priceData, err := ModelPriceHelper(ctx, info, 2000, &types.TokenCountMeta{})
				require.NoError(t, err)
				require.Equal(t, modelRatios[modelName], priceData.ModelRatio)
				require.Equal(t, 6.0, priceData.CompletionRatio)
				require.Equal(t, 0.1, priceData.CacheRatio)
				require.Equal(t, 1.25, priceData.CacheCreationRatio)
				require.Equal(t, discount, priceData.GroupRatioInfo.GroupRatio)
				require.Equal(t, int(2000*modelRatios[modelName]*discount), priceData.QuotaToPreConsume)
			})
		}
	}
}
