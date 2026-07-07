package gemini

import (
	"testing"

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
