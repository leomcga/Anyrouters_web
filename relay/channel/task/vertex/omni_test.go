package vertex

import (
	"io"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	geminitask "github.com/QuantumNous/new-api/relay/channel/task/gemini"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOmniBuildRequestURLUsesInteractionsEndpoint(t *testing.T) {
	adaptor := &TaskAdaptor{
		apiKey: `{"project_id":"anyrouters-prod"}`,
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: geminitask.OmniFlashPreviewModel,
		},
	}

	got, err := adaptor.BuildRequestURL(info)

	require.NoError(t, err)
	require.Equal(t, "https://aiplatform.googleapis.com/v1beta1/projects/anyrouters-prod/locations/global/interactions", got)
}

func TestOmniBuildRequestBodyUsesInteractionShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:   "A quiet cinematic city street at night.",
		Metadata: map[string]any{"aspectRatio": "9:16"},
	})
	adaptor := &TaskAdaptor{}

	body, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: geminitask.OmniFlashPreviewModel,
		},
	})
	require.NoError(t, err)
	raw, err := io.ReadAll(body)
	require.NoError(t, err)

	require.JSONEq(t, `{
		"model":"gemini-omni-flash-preview",
		"input":"A quiet cinematic city street at night.",
		"background":true,
		"response_format":{"type":"video","aspect_ratio":"9:16"},
		"generation_config":{"video_config":{"task":"text_to_video"}}
	}`, string(raw))
}

func TestOmniBuildRequestBodyUsesOfficialImageInputAndTask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt: "Animate this product shot with a slow camera orbit.",
		Images: []string{
			"data:image/png;base64,QUJD",
			"data:image/jpeg;base64,REVG",
		},
		Metadata: map[string]any{"aspectRatio": "16:9"},
	})
	adaptor := &TaskAdaptor{}

	body, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: geminitask.OmniFlashPreviewModel,
		},
	})
	require.NoError(t, err)
	raw, err := io.ReadAll(body)
	require.NoError(t, err)

	require.JSONEq(t, `{
		"model":"gemini-omni-flash-preview",
		"input":[
			{"type":"image","mime_type":"image/png","data":"QUJD"},
			{"type":"image","mime_type":"image/jpeg","data":"REVG"},
			{"type":"text","text":"Animate this product shot with a slow camera orbit."}
		],
		"background":true,
		"response_format":{"type":"video","aspect_ratio":"16:9"},
		"generation_config":{"video_config":{"task":"reference_to_video"}}
	}`, string(raw))
}

func TestOmniBuildRequestBodyHonorsExplicitTaskAndPreviousInteraction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt: "Make the violin invisible.",
		Metadata: map[string]any{
			"task":                    "edit",
			"previous_interaction_id": "v1_prev",
		},
	})
	adaptor := &TaskAdaptor{}

	body, err := adaptor.BuildRequestBody(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: geminitask.OmniFlashPreviewModel,
		},
	})
	require.NoError(t, err)
	raw, err := io.ReadAll(body)
	require.NoError(t, err)

	require.JSONEq(t, `{
		"model":"gemini-omni-flash-preview",
		"input":"Make the violin invisible.",
		"background":true,
		"previous_interaction_id":"v1_prev",
		"response_format":{"type":"video","aspect_ratio":"16:9"},
		"generation_config":{"video_config":{"task":"edit"}}
	}`, string(raw))
}

func TestOmniEstimateBillingUsesFixedPreviewDuration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:   "short clip",
		Duration: 4,
		Metadata: map[string]any{"durationSeconds": 4},
	})
	adaptor := &TaskAdaptor{}

	ratios := adaptor.EstimateBilling(c, &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: geminitask.OmniFlashPreviewModel,
		},
	})

	require.Equal(t, map[string]float64{"seconds": 8}, ratios)
}

func TestParseOmniTaskResultExtractsVideoFromSteps(t *testing.T) {
	resp := []byte(`{
		"object":"interaction",
		"id":"v1_test",
		"status":"completed",
		"model":"gemini-omni-flash-preview",
		"steps":[
			{"type":"user_input","content":[{"type":"text","text":"make a video"}]},
			{"type":"model_output","content":[{"type":"video","mime_type":"video/mp4","data":"AAAA"}]}
		]
	}`)

	ti, err := (&TaskAdaptor{}).ParseTaskResult(resp)

	require.NoError(t, err)
	require.Equal(t, string(model.TaskStatusSuccess), ti.Status)
	require.Equal(t, "100%", ti.Progress)
	require.True(t, strings.HasPrefix(ti.Url, "data:video/mp4;base64,AAAA"))
}

func TestParseOmniTaskResultPendingWithoutVideo(t *testing.T) {
	resp := []byte(`{
		"object":"interaction",
		"id":"v1_test",
		"status":"running",
		"model":"gemini-omni-flash-preview"
	}`)

	ti, err := (&TaskAdaptor{}).ParseTaskResult(resp)

	require.NoError(t, err)
	require.Equal(t, string(model.TaskStatusInProgress), ti.Status)
	require.Equal(t, "50%", ti.Progress)
}
