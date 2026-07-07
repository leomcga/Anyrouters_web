package dto

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGPTImage2PriceRatioUsesExactQualitySizeTiers(t *testing.T) {
	cases := []struct {
		name    string
		quality string
		size    string
		want    float64
	}{
		{name: "square low", quality: "low", size: "1024x1024", want: 0.006 / 0.211},
		{name: "square medium", quality: "medium", size: "1024x1024", want: 0.053 / 0.211},
		{name: "square high", quality: "high", size: "1024x1024", want: 1},
		{name: "landscape low", quality: "low", size: "1536x1024", want: 0.005 / 0.211},
		{name: "portrait medium", quality: "medium", size: "1024x1536", want: 0.041 / 0.211},
		{name: "landscape high", quality: "high", size: "1536x1024", want: 0.165 / 0.211},
		{name: "auto defaults high square", quality: "auto", size: "auto", want: 1},
		{name: "unknown defaults high square", quality: "weird", size: "2048x2048", want: 1},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			req := ImageRequest{
				Model:   "gpt-image-2",
				Prompt:  "draw",
				Quality: tt.quality,
				Size:    tt.size,
			}

			require.InEpsilon(t, tt.want, req.GetTokenCountMeta().ImagePriceRatio, 0.000001)
		})
	}
}
