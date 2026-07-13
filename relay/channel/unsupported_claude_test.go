package channel_test

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/baidu"
	"github.com/QuantumNous/new-api/relay/channel/cloudflare"
	"github.com/QuantumNous/new-api/relay/channel/cohere"
	"github.com/QuantumNous/new-api/relay/channel/dify"
	"github.com/QuantumNous/new-api/relay/channel/jina"
	"github.com/QuantumNous/new-api/relay/channel/mistral"
	"github.com/QuantumNous/new-api/relay/channel/mokaai"
	"github.com/QuantumNous/new-api/relay/channel/palm"
	"github.com/QuantumNous/new-api/relay/channel/tencent"
	"github.com/QuantumNous/new-api/relay/channel/xunfei"
	"github.com/QuantumNous/new-api/relay/channel/zhipu"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type unsupportedClaudeConverter interface {
	ConvertClaudeRequest(*gin.Context, *relaycommon.RelayInfo, *dto.ClaudeRequest) (any, error)
}

func TestUnsupportedClaudeConvertersReturnErrorsWithoutPanicking(t *testing.T) {
	converters := map[string]unsupportedClaudeConverter{
		"baidu":      &baidu.Adaptor{},
		"cloudflare": &cloudflare.Adaptor{},
		"cohere":     &cohere.Adaptor{},
		"dify":       &dify.Adaptor{},
		"jina":       &jina.Adaptor{},
		"mistral":    &mistral.Adaptor{},
		"mokaai":     &mokaai.Adaptor{},
		"palm":       &palm.Adaptor{},
		"tencent":    &tencent.Adaptor{},
		"xunfei":     &xunfei.Adaptor{},
		"zhipu":      &zhipu.Adaptor{},
	}

	for name, converter := range converters {
		t.Run(name, func(t *testing.T) {
			require.NotPanics(t, func() {
				value, err := converter.ConvertClaudeRequest(nil, nil, nil)
				require.Nil(t, value)
				require.Error(t, err)
			})
		})
	}
}
