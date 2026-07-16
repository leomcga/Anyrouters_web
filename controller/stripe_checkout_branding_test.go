package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
)

func requireStripeCheckoutDisplayName(t *testing.T, form url.Values) {
	t.Helper()
	require.Equal(t, stripeCheckoutDisplayName, form.Get("branding_settings[display_name]"))
}

func TestStripeCheckoutLinksUseAnyRoutersDisplayName(t *testing.T) {
	originalBackend := stripe.GetBackend(stripe.APIBackend)
	originalStripeKey := stripe.Key
	originalSecret := setting.StripeApiSecret
	originalPriceID := setting.StripePriceId
	originalUnitPrice := setting.StripeUnitPrice

	requests := make(chan url.Values, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		requests <- r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cs_test_branding","object":"checkout.session","url":"https://checkout.stripe.test/session"}`))
	}))

	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(
		stripe.APIBackend,
		&stripe.BackendConfig{
			URL:               stripe.String(server.URL),
			HTTPClient:        server.Client(),
			MaxNetworkRetries: stripe.Int64(0),
		},
	))

	t.Cleanup(func() {
		server.Close()
		stripe.SetBackend(stripe.APIBackend, originalBackend)
		stripe.Key = originalStripeKey
		setting.StripeApiSecret = originalSecret
		setting.StripePriceId = originalPriceID
		setting.StripeUnitPrice = originalUnitPrice
	})

	setting.StripeApiSecret = "sk_test_branding"
	setting.StripePriceId = "price_test_branding"
	setting.StripeUnitPrice = 1

	topupURL, err := genStripeLink("ref_branding", "", "user@example.com", 5, 5, "", "")
	require.NoError(t, err)
	require.Equal(t, "https://checkout.stripe.test/session", topupURL)
	requireStripeCheckoutDisplayName(t, <-requests)

	subscriptionURL, err := genStripeSubscriptionLink("sub_ref_branding", "", "user@example.com", "price_subscription")
	require.NoError(t, err)
	require.Equal(t, "https://checkout.stripe.test/session", subscriptionURL)
	requireStripeCheckoutDisplayName(t, <-requests)
}
