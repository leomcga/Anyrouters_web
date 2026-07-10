package gemini

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestVeoResolutionRatioUsesOfficialResolutionTiers(t *testing.T) {
	cases := []struct {
		name       string
		model      string
		resolution string
		want       float64
	}{
		{name: "veo 3.1 standard 720p", model: "veo-3.1-generate-preview", resolution: "720p", want: 1},
		{name: "veo 3.1 standard 1080p", model: "veo-3.1-generate-preview", resolution: "1080p", want: 1},
		{name: "veo 3.1 standard 4k", model: "veo-3.1-generate-preview", resolution: "4k", want: 1.5},
		{name: "veo 3.1 fast 720p", model: "veo-3.1-fast-generate-preview", resolution: "720p", want: 1},
		{name: "veo 3.1 fast 1080p", model: "veo-3.1-fast-generate-preview", resolution: "1080p", want: 1.2},
		{name: "veo 3.1 fast 4k", model: "veo-3.1-fast-generate-preview", resolution: "4k", want: 3},
		{name: "veo 3 fast 1080p", model: "veo-3.0-fast-generate-001", resolution: "1080p", want: 1.2},
		{name: "veo 3 standard 1080p", model: "veo-3.0-generate-001", resolution: "1080p", want: 1},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			require.InEpsilon(t, tt.want, VeoResolutionRatio(tt.model, tt.resolution), 0.000001)
		})
	}
}

func TestTaskAdaptorEstimateBillingUsesOfficialAudioPricing(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name          string
		model         string
		resolution    string
		generateAudio any
		wantAudio     float64
	}{
		{
			name:          "omitted audio defaults to enabled",
			model:         "veo-3.1-fast-generate-preview",
			resolution:    "720p",
			generateAudio: nil,
			wantAudio:     1,
		},
		{
			name:          "standard 720p without audio",
			model:         "veo-3.1-generate-preview",
			resolution:    "720p",
			generateAudio: false,
			wantAudio:     0.5,
		},
		{
			name:          "standard 4k without audio",
			model:         "veo-3.1-generate-preview",
			resolution:    "4k",
			generateAudio: false,
			wantAudio:     2.0 / 3.0,
		},
		{
			name:          "fast 720p without audio",
			model:         "veo-3.1-fast-generate-preview",
			resolution:    "720p",
			generateAudio: false,
			wantAudio:     0.8,
		},
		{
			name:          "fast 1080p without audio",
			model:         "veo-3.1-fast-generate-preview",
			resolution:    "1080p",
			generateAudio: false,
			wantAudio:     5.0 / 6.0,
		},
		{
			name:          "fast 4k without audio",
			model:         "veo-3.1-fast-generate-preview",
			resolution:    "4k",
			generateAudio: false,
			wantAudio:     5.0 / 6.0,
		},
		{
			name:          "veo 3 fast 1080p without audio",
			model:         "veo-3.0-fast-generate-001",
			resolution:    "1080p",
			generateAudio: false,
			wantAudio:     5.0 / 6.0,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			metadata := map[string]any{"resolution": tt.resolution}
			if tt.generateAudio != nil {
				metadata["generateAudio"] = tt.generateAudio
			}

			c, _ := gin.CreateTestContext(nil)
			c.Set("task_request", relaycommon.TaskSubmitReq{
				Duration: 1,
				Metadata: metadata,
			})

			ratios := (&TaskAdaptor{}).EstimateBilling(c, &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{
					UpstreamModelName: tt.model,
				},
			})

			require.Equal(t, 1.0, ratios["seconds"])
			require.InEpsilon(t, VeoResolutionRatio(tt.model, tt.resolution), ratios["resolution"], 0.000001)
			require.InEpsilon(t, tt.wantAudio, ratios["audio"], 0.000001)
		})
	}
}
