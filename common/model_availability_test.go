package common

import "testing"

func TestIsModelTemporarilyUnavailable(t *testing.T) {
	t.Setenv(temporarilyUnavailableModelsEnv, "*claude*, exact-model")

	for _, modelName := range []string{
		"claude-sonnet-4-6",
		"CLAUDE-OPUS-4-8",
		"anthropic.claude-3-5-sonnet",
		"exact-model",
	} {
		if !IsModelTemporarilyUnavailable(modelName) {
			t.Fatalf("expected %q to be temporarily unavailable", modelName)
		}
	}
	for _, modelName := range []string{"gpt-5.6", "gemini-3.5-pro", ""} {
		if IsModelTemporarilyUnavailable(modelName) {
			t.Fatalf("did not expect %q to be temporarily unavailable", modelName)
		}
	}
}
