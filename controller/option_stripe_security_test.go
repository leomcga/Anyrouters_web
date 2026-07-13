package controller

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func preserveStripeOptionGlobals(t *testing.T) {
	t.Helper()
	originalMap := common.OptionMap
	originalAPI := setting.StripeApiSecret
	originalWebhook := setting.StripeWebhookSecret
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalMap
		common.OptionMapRWMutex.Unlock()
		setting.StripeApiSecret = originalAPI
		setting.StripeWebhookSecret = originalWebhook
	})
}

func TestGetOptionsReturnsOnlySafeStripeConfigurationMetadata(t *testing.T) {
	preserveStripeOptionGlobals(t)
	setting.StripeApiSecret = "sk_test_do_not_return"
	setting.StripeWebhookSecret = "whsec_do_not_return"
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{
		"StripeApiSecret":     "legacy-api-secret",
		"StripeWebhookSecret": "legacy-webhook-secret",
		"StripePriceId":       "price_safe",
	}
	common.OptionMapRWMutex.Unlock()

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	GetOptions(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	body := recorder.Body.String()
	for _, forbidden := range []string{
		"sk_test_do_not_return",
		"whsec_do_not_return",
		"legacy-api-secret",
		"legacy-webhook-secret",
	} {
		require.NotContains(t, body, forbidden)
	}
	require.Contains(t, body, "StripeConfigured")
	require.Contains(t, body, "StripeWebhookConfigured")
	require.Contains(t, body, "StripeMode")
	require.Contains(t, body, "StripeKeyType")
}

func TestUpdateOptionRejectsStripeSecrets(t *testing.T) {
	preserveStripeOptionGlobals(t)
	gin.SetMode(gin.TestMode)
	for _, key := range []string{"StripeApiSecret", "StripeWebhookSecret"} {
		payload, err := json.Marshal(OptionUpdateRequest{Key: key, Value: "must-not-save"})
		require.NoError(t, err)
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPut, "/api/option", bytes.NewReader(payload))

		UpdateOption(context)

		require.Equal(t, http.StatusBadRequest, recorder.Code)
		require.NotContains(t, recorder.Body.String(), "must-not-save")
	}
}
