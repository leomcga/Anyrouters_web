package dto

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestGeneralOpenAIRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"stream":false,
		"max_tokens":0,
		"max_completion_tokens":0,
		"top_p":0,
		"top_k":0,
		"n":0,
		"frequency_penalty":0,
		"presence_penalty":0,
		"seed":0,
		"logprobs":false,
		"top_logprobs":0,
		"dimensions":0,
		"return_images":false,
		"return_related_questions":false
	}`)

	var req GeneralOpenAIRequest
	err := common.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := common.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_completion_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_k").Exists())
	require.True(t, gjson.GetBytes(encoded, "n").Exists())
	require.True(t, gjson.GetBytes(encoded, "frequency_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "presence_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "seed").Exists())
	require.True(t, gjson.GetBytes(encoded, "logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "dimensions").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_images").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_related_questions").Exists())
}

func TestOpenAIResponsesRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"max_output_tokens":0,
		"max_tool_calls":0,
		"stream":false,
		"top_p":0
	}`)

	var req OpenAIResponsesRequest
	err := common.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := common.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "max_output_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tool_calls").Exists())
	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
}

func TestGeneralOpenAIRequestGetSystemRoleName(t *testing.T) {
	tests := []struct {
		name  string
		model string
		want  string
	}{
		{name: "o1 uses developer", model: "o1", want: "developer"},
		{name: "o3 family uses developer", model: "o3-mini-high", want: "developer"},
		{name: "o4 family uses developer", model: "o4-mini", want: "developer"},
		{name: "o1 mini stays system", model: "o1-mini", want: "system"},
		{name: "o1 preview stays system", model: "o1-preview", want: "system"},
		{name: "gpt 5 uses developer", model: "gpt-5", want: "developer"},
		{name: "omni is not o series", model: "omni-moderation-latest", want: "system"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := GeneralOpenAIRequest{Model: tt.model}

			require.Equal(t, tt.want, req.GetSystemRoleName())
		})
	}
}

func TestGeminiImageSizeRatio(t *testing.T) {
	cases := []struct {
		name  string
		model string
		size  string
		want  float64
	}{
		{name: "flash 0.5K", model: "gemini-3.1-flash-image", size: "0.5K", want: 0.045 / 0.067},
		{name: "flash 1K base", model: "gemini-3.1-flash-image", size: "1K", want: 0},
		{name: "flash 2K", model: "gemini-3.1-flash-image", size: "2K", want: 0.101 / 0.067},
		{name: "flash 4K", model: "gemini-3.1-flash-image", size: "4K", want: 0.151 / 0.067},
		{name: "pro 2K same as 1K", model: "gemini-3-pro-image", size: "2K", want: 0},
		{name: "pro 4K", model: "gemini-3-pro-image", size: "4K", want: 0.24 / 0.134},
		{name: "lite ignores unsupported tier", model: "gemini-3.1-flash-lite-image", size: "2K", want: 0},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			raw := []byte(`{
				"model":"` + tt.model + `",
				"messages":[{"role":"user","content":"draw"}],
				"extra_body":{"google":{"image_config":{"image_size":"` + tt.size + `"}}}
			}`)
			var req GeneralOpenAIRequest
			require.NoError(t, common.Unmarshal(raw, &req))

			got := req.GetTokenCountMeta().ImagePriceRatio
			if tt.want == 0 {
				require.Equal(t, tt.want, got)
				return
			}
			require.InEpsilon(t, tt.want, got, 0.000001)
		})
	}
}
