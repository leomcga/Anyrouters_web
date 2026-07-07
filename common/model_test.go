package common

import "testing"

func TestIsVideoGenerationModelIncludesOmni(t *testing.T) {
	if !IsVideoGenerationModel("gemini-omni-flash-preview") {
		t.Fatal("gemini-omni-flash-preview should be treated as a video generation model")
	}
}
