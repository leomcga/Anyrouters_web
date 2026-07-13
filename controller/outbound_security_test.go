package controller

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestChannelBaseURLValidationRejectsPrivateAndCredentialBearingTargets(t *testing.T) {
	oldAllowHTTP := common.OutboundAllowHTTP
	common.OutboundAllowHTTP = true
	t.Cleanup(func() { common.OutboundAllowHTTP = oldAllowHTTP })

	for _, baseURL := range []string{
		"http://127.0.0.1:11434",
		"http://2130706433",
		"https://user:pass@example.com",
		"http://metadata.google.internal",
	} {
		baseURL := baseURL
		t.Run(baseURL, func(t *testing.T) {
			channel := &model.Channel{Key: "test-key", BaseURL: &baseURL}
			require.Error(t, validateChannel(channel, true))
		})
	}
}

func TestChannelBaseURLValidationAllowsPublicHTTPSAndAuditTemplateExists(t *testing.T) {
	baseURL := "https://93.184.216.34"
	channel := &model.Channel{Key: "test-key", BaseURL: &baseURL}
	require.NoError(t, validateChannel(channel, true))
	require.Contains(t, auditContentEN("channel.update", map[string]interface{}{
		"id":   1,
		"name": "secure-channel",
	}), "secure-channel")
}

func TestOIDCDiscoveryRejectsPrivateEndpoints(t *testing.T) {
	discovery := map[string]any{
		"authorization_endpoint": "https://93.184.216.34/authorize",
		"token_endpoint":         "http://169.254.169.254/token",
		"jwks_uri":               "https://93.184.216.34/jwks",
	}
	require.Error(t, validateOAuthDiscoveryEndpoints(context.Background(), discovery))
}
