package middleware

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveMappedModelForAuthorization(t *testing.T) {
	finalModel, err := resolveMappedModelForAuthorization(
		"friendly-model",
		`{"friendly-model":"provider-model","provider-model":"provider-model-v2"}`,
	)
	require.NoError(t, err)
	require.Equal(t, "provider-model-v2", finalModel)
}

func TestResolveMappedModelForAuthorizationRejectsCycle(t *testing.T) {
	_, err := resolveMappedModelForAuthorization(
		"friendly-model",
		`{"friendly-model":"provider-model","provider-model":"friendly-model"}`,
	)
	require.Error(t, err)
}
