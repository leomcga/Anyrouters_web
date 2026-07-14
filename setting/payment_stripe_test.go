package setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateStripeProductionConfig(t *testing.T) {
	originalAPI := StripeApiSecret
	originalWebhook := StripeWebhookSecret
	t.Cleanup(func() {
		StripeApiSecret = originalAPI
		StripeWebhookSecret = originalWebhook
	})
	t.Setenv("APP_ENV", "production")

	StripeApiSecret = "sk_test_example"
	StripeWebhookSecret = "whsec_example"
	require.Error(t, ValidateStripeProductionConfig())

	StripeApiSecret = "sk_live_example"
	StripeWebhookSecret = ""
	require.Error(t, ValidateStripeProductionConfig())

	StripeWebhookSecret = "whsec_example"
	require.NoError(t, ValidateStripeProductionConfig())
}

func TestProductionStripeConfigurationFailsClosedWhenSecretsAreMissing(t *testing.T) {
	originalAPI := StripeApiSecret
	originalWebhook := StripeWebhookSecret
	t.Cleanup(func() {
		StripeApiSecret = originalAPI
		StripeWebhookSecret = originalWebhook
	})
	t.Setenv("APP_ENV", "production")

	StripeApiSecret = ""
	StripeWebhookSecret = ""
	require.Error(t, ValidateStripeProductionConfig())

	StripeApiSecret = "sk_live_example"
	require.Error(t, ValidateStripeProductionConfig())
}

func TestStripeModeAndKeyTypeAreSafeMetadata(t *testing.T) {
	originalAPI := StripeApiSecret
	originalWebhook := StripeWebhookSecret
	t.Cleanup(func() {
		StripeApiSecret = originalAPI
		StripeWebhookSecret = originalWebhook
	})

	StripeApiSecret = "rk_test_example"
	StripeWebhookSecret = "whsec_example"
	require.Equal(t, "test", StripeMode())
	require.Equal(t, "restricted", StripeKeyType())
	require.True(t, StripeConfigured())
	require.True(t, StripeWebhookConfigured())

	StripeApiSecret = "sk_live_example"
	require.Equal(t, "live", StripeMode())
	require.Equal(t, "secret", StripeKeyType())
}

func TestExplicitStripeModeRequiresMatchingKey(t *testing.T) {
	originalAPI := StripeApiSecret
	originalWebhook := StripeWebhookSecret
	t.Cleanup(func() {
		StripeApiSecret = originalAPI
		StripeWebhookSecret = originalWebhook
	})
	t.Setenv("APP_ENV", "staging")
	t.Setenv("STRIPE_MODE", "live")

	StripeApiSecret = ""
	require.Error(t, ValidateStripeProductionConfig())

	StripeApiSecret = "sk_test_example"
	require.Error(t, ValidateStripeProductionConfig())

	StripeApiSecret = "sk_live_example"
	require.NoError(t, ValidateStripeProductionConfig())
}
