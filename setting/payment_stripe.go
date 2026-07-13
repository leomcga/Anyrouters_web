package setting

import (
	"errors"
	"os"
	"strings"

	"github.com/shopspring/decimal"
)

var StripeApiSecret = ""
var StripeWebhookSecret = ""
var StripePriceId = ""
var StripeUnitPrice = 8.0
var StripeUnitPriceText = "8"
var StripeMinTopUp = 1
var StripePromotionCodesEnabled = false
var StripeSuccessURL = ""
var StripeCancelURL = ""

func init() {
	LoadStripeSecretsFromEnvironment()
	StripeSuccessURL = strings.TrimSpace(os.Getenv("STRIPE_SUCCESS_URL"))
	StripeCancelURL = strings.TrimSpace(os.Getenv("STRIPE_CANCEL_URL"))
}

func LoadStripeSecretsFromEnvironment() {
	StripeApiSecret = strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY"))
	StripeWebhookSecret = strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET"))
}

func StripeConfigured() bool {
	return strings.TrimSpace(StripeApiSecret) != ""
}

func StripeWebhookConfigured() bool {
	return strings.TrimSpace(StripeWebhookSecret) != ""
}

func StripeMode() string {
	secret := strings.TrimSpace(StripeApiSecret)
	switch {
	case strings.HasPrefix(secret, "sk_live_"), strings.HasPrefix(secret, "rk_live_"):
		return "live"
	case strings.HasPrefix(secret, "sk_test_"), strings.HasPrefix(secret, "rk_test_"):
		return "test"
	default:
		return "disabled"
	}
}

func StripeKeyType() string {
	secret := strings.TrimSpace(StripeApiSecret)
	switch {
	case strings.HasPrefix(secret, "sk_"):
		return "secret"
	case strings.HasPrefix(secret, "rk_"):
		return "restricted"
	default:
		return "none"
	}
}

func SetStripeUnitPrice(value string) error {
	value = strings.TrimSpace(value)
	price, err := decimal.NewFromString(value)
	if err != nil || !price.IsPositive() {
		return errors.New("invalid Stripe unit price")
	}
	if price.Exponent() < -4 {
		return errors.New("Stripe unit price supports at most four decimal places")
	}
	asFloat, _ := price.Float64()
	StripeUnitPriceText = price.String()
	StripeUnitPrice = asFloat
	return nil
}

func ValidateStripeProductionConfig() error {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	configuredMode := StripeMode()
	requestedMode := strings.ToLower(strings.TrimSpace(os.Getenv("STRIPE_MODE")))
	if requestedMode != "" && requestedMode != "test" && requestedMode != "live" {
		return errors.New("STRIPE_MODE must be test or live")
	}
	if requestedMode != "" {
		if configuredMode == "disabled" {
			return errors.New("STRIPE_MODE requires STRIPE_SECRET_KEY")
		}
		if requestedMode != configuredMode {
			return errors.New("STRIPE_MODE does not match STRIPE_SECRET_KEY")
		}
	}
	if env != "production" && env != "prod" {
		return nil
	}
	if !StripeConfigured() {
		return errors.New("production Stripe requires STRIPE_SECRET_KEY")
	}
	if configuredMode != "live" {
		return errors.New("production cannot use a Stripe test key")
	}
	if !StripeWebhookConfigured() {
		return errors.New("production Stripe requires STRIPE_WEBHOOK_SECRET")
	}
	return nil
}
