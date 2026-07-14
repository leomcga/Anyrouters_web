package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/webhook"
	"gorm.io/gorm"
)

func setupStripeControllerTestDB(t *testing.T) {
	t.Helper()
	originalGinMode := gin.Mode()
	originalUsingSQLite := common.UsingSQLite
	originalUsingMySQL := common.UsingMySQL
	originalUsingPostgreSQL := common.UsingPostgreSQL
	originalDB := model.DB
	originalLogDB := model.LOG_DB
	originalAPISecret := setting.StripeApiSecret
	originalWebhookSecret := setting.StripeWebhookSecret
	originalStripeKey := stripe.Key
	gin.SetMode(gin.TestMode)
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Log{},
		&model.TopUp{},
		&model.SubscriptionPlan{},
		&model.SubscriptionOrder{},
		&model.UserSubscription{},
		&model.StripePaymentOrder{},
		&model.StripeWebhookEvent{},
		&model.PaymentCreditLedger{},
		&model.PaymentAudit{},
	))
	setting.StripeApiSecret = "sk_test_controller"
	setting.StripeWebhookSecret = "whsec_controller"
	t.Cleanup(func() {
		common.UsingSQLite = originalUsingSQLite
		common.UsingMySQL = originalUsingMySQL
		common.UsingPostgreSQL = originalUsingPostgreSQL
		model.DB = originalDB
		model.LOG_DB = originalLogDB
		setting.StripeApiSecret = originalAPISecret
		setting.StripeWebhookSecret = originalWebhookSecret
		stripe.Key = originalStripeKey
		gin.SetMode(originalGinMode)
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
}

func TestStripeControllerTestGlobalsAreRestored(t *testing.T) {
	originalUsingSQLite := common.UsingSQLite
	originalUsingMySQL := common.UsingMySQL
	originalUsingPostgreSQL := common.UsingPostgreSQL
	originalDB := model.DB
	originalLogDB := model.LOG_DB
	originalAPISecret := setting.StripeApiSecret
	originalWebhookSecret := setting.StripeWebhookSecret
	originalStripeKey := stripe.Key

	t.Run("mutates globals inside fixture", func(t *testing.T) {
		setupStripeControllerTestDB(t)
		require.True(t, common.UsingSQLite)
		require.False(t, common.UsingMySQL)
		require.False(t, common.UsingPostgreSQL)
		require.NotSame(t, originalDB, model.DB)
		require.Equal(t, "sk_test_controller", setting.StripeApiSecret)
		require.Equal(t, "whsec_controller", setting.StripeWebhookSecret)
	})

	require.Equal(t, originalUsingSQLite, common.UsingSQLite)
	require.Equal(t, originalUsingMySQL, common.UsingMySQL)
	require.Equal(t, originalUsingPostgreSQL, common.UsingPostgreSQL)
	require.Same(t, originalDB, model.DB)
	require.Same(t, originalLogDB, model.LOG_DB)
	require.Equal(t, originalAPISecret, setting.StripeApiSecret)
	require.Equal(t, originalWebhookSecret, setting.StripeWebhookSecret)
	require.Equal(t, originalStripeKey, stripe.Key)
}

func stripeWebhookRecorder(payload []byte, signature string, withLimit bool) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", bytes.NewReader(payload))
	if signature != "" {
		context.Request.Header.Set("Stripe-Signature", signature)
	}
	if withLimit {
		middleware.AnonymousRequestBodyLimit()(context)
		if context.IsAborted() {
			return recorder
		}
	} else {
		context.Set("anonymous_request_body", payload)
	}
	StripeWebhook(context)
	return recorder
}

func signedStripePayload(payload []byte, timestamp time.Time) *webhook.SignedPayload {
	return webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
		Payload:   payload,
		Secret:    setting.StripeWebhookSecret,
		Timestamp: timestamp,
	})
}

func TestStripeWebhookSignatureValidation(t *testing.T) {
	setupStripeControllerTestDB(t)
	payload := []byte(fmt.Sprintf(`{"id":"evt_signature","object":"event","api_version":%q,"type":"customer.created","livemode":false,"data":{"object":{"id":"cus_1"}}}`, stripe.APIVersion))
	valid := signedStripePayload(payload, time.Now())
	require.Equal(t, http.StatusOK, stripeWebhookRecorder(payload, valid.Header, false).Code)
	require.Equal(t, http.StatusBadRequest, stripeWebhookRecorder(payload, "", false).Code)
	require.Equal(t, http.StatusBadRequest, stripeWebhookRecorder(payload, "t=1,v1=invalid", false).Code)
	expired := signedStripePayload(payload, time.Now().Add(-10*time.Minute))
	require.Equal(t, http.StatusBadRequest, stripeWebhookRecorder(payload, expired.Header, false).Code)
	changed := append(append([]byte{}, payload...), '\n')
	require.Equal(t, http.StatusBadRequest, stripeWebhookRecorder(changed, valid.Header, false).Code)
}

func TestStripeWebhookBodyLimitRejectsOversizedPayload(t *testing.T) {
	setupStripeControllerTestDB(t)
	originalLimit := constant.AnonymousRequestBodyLimitKB
	constant.AnonymousRequestBodyLimitKB = 1
	t.Cleanup(func() { constant.AnonymousRequestBodyLimitKB = originalLimit })
	payload := bytes.Repeat([]byte("x"), 1025)
	require.Equal(t, http.StatusRequestEntityTooLarge, stripeWebhookRecorder(payload, "unused", true).Code)
}

func TestStripeWebhookUnsupportedEventIsPersistedAndIgnored(t *testing.T) {
	setupStripeControllerTestDB(t)
	payload := []byte(fmt.Sprintf(`{"id":"evt_ignored","object":"event","api_version":%q,"type":"customer.created","livemode":false,"data":{"object":{"id":"cus_ignored"}}}`, stripe.APIVersion))
	signed := signedStripePayload(payload, time.Now())
	require.Equal(t, http.StatusOK, stripeWebhookRecorder(payload, signed.Header, false).Code)
	var event model.StripeWebhookEvent
	require.NoError(t, model.DB.Where("stripe_event_id = ?", "evt_ignored").First(&event).Error)
	require.Equal(t, model.StripeEventStatusIgnored, event.Status)
	var ledgers int64
	require.NoError(t, model.DB.Model(&model.PaymentCreditLedger{}).Count(&ledgers).Error)
	require.Zero(t, ledgers)
}

func TestStripeWebhookRejectsTestEventInProduction(t *testing.T) {
	setupStripeControllerTestDB(t)
	t.Setenv("APP_ENV", "production")
	setting.StripeApiSecret = "sk_live_controller"
	payload := []byte(fmt.Sprintf(`{"id":"evt_test_in_prod","object":"event","api_version":%q,"type":"customer.created","livemode":false,"data":{"object":{"id":"cus_test"}}}`, stripe.APIVersion))
	signed := signedStripePayload(payload, time.Now())
	require.Equal(t, http.StatusBadRequest, stripeWebhookRecorder(payload, signed.Header, false).Code)
	var count int64
	require.NoError(t, model.DB.Model(&model.StripeWebhookEvent{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestStripeWebhookValidPaymentCreditsAtomically(t *testing.T) {
	setupStripeControllerTestDB(t)
	user := &model.User{Id: 771, Username: "stripe_webhook_user", Password: "unused", Quota: 1000, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(user).Error)
	order := &model.StripePaymentOrder{
		OrderNo:                 "sp_webhook",
		OrderKind:               model.StripeOrderKindTopUp,
		UserId:                  user.Id,
		Status:                  model.StripeOrderStatusCheckoutCreated,
		ExpectedAmountMinor:     800,
		Currency:                "usd",
		CreditedQuota:           100,
		StripeCheckoutSessionId: "cs_webhook",
		StripePaymentIntentId:   "pi_webhook",
		PriceConfigVersion:      "v1",
		PriceSnapshot:           `{}`,
		IdempotencyKey:          "stripe:checkout:sp_webhook",
		CheckoutSuccessUrl:      "https://example.com/success",
		CheckoutCancelUrl:       "https://example.com/cancel",
	}
	require.NoError(t, model.CreateStripeTopUpOrder(order, &model.TopUp{Amount: 1, Money: 1}))
	payload := []byte(fmt.Sprintf(`{
		"id":"evt_webhook_success","object":"event","api_version":%q,
		"type":"checkout.session.completed","livemode":false,
		"data":{"object":{
			"id":"cs_webhook","object":"checkout.session","client_reference_id":"sp_webhook",
			"metadata":{"order_no":"sp_webhook","order_kind":"topup"},
			"payment_intent":"pi_webhook","amount_total":800,"currency":"usd",
			"payment_status":"paid","status":"complete","livemode":false
		}}
	}`, stripe.APIVersion))
	signed := signedStripePayload(payload, time.Now())
	require.Equal(t, http.StatusOK, stripeWebhookRecorder(payload, signed.Header, false).Code)

	var storedUser model.User
	require.NoError(t, model.DB.First(&storedUser, user.Id).Error)
	require.Equal(t, 1100, storedUser.Quota)
	var ledger model.PaymentCreditLedger
	require.NoError(t, model.DB.Where("order_no = ?", order.OrderNo).First(&ledger).Error)
	var audit model.PaymentAudit
	require.NoError(t, model.DB.Where("order_no = ?", order.OrderNo).First(&audit).Error)
}

func TestStripeAdminRepairUsesVerifiedObjectAndAdminAudit(t *testing.T) {
	setupStripeControllerTestDB(t)
	user := &model.User{Id: 772, Username: "stripe_admin_user", Password: "unused", Quota: 1000, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(user).Error)
	order := &model.StripePaymentOrder{
		OrderNo:                 "sp_admin",
		OrderKind:               model.StripeOrderKindTopUp,
		UserId:                  user.Id,
		Status:                  model.StripeOrderStatusCheckoutCreated,
		ExpectedAmountMinor:     800,
		Currency:                "usd",
		CreditedQuota:           100,
		StripeCheckoutSessionId: "cs_admin",
		PriceConfigVersion:      "v1",
		PriceSnapshot:           `{}`,
		IdempotencyKey:          "stripe:checkout:sp_admin",
		CheckoutSuccessUrl:      "https://example.com/success",
		CheckoutCancelUrl:       "https://example.com/cancel",
	}
	require.NoError(t, model.CreateStripeTopUpOrder(order, &model.TopUp{Amount: 1, Money: 1}))
	originalGet := stripeGetCheckoutSession
	t.Cleanup(func() { stripeGetCheckoutSession = originalGet })
	stripeGetCheckoutSession = func(string, *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		return &stripe.CheckoutSession{
			ID:                "cs_admin",
			ClientReferenceID: "sp_admin",
			AmountTotal:       800,
			Currency:          "usd",
			PaymentStatus:     "paid",
			Metadata:          map[string]string{"order_no": "sp_admin"},
		}, nil
	}
	require.NoError(t, RepairStripePaymentOrder("sp_admin", "cs_admin", model.StripePaymentActor{
		Type:   "admin",
		Id:     99,
		Reason: "manual verification",
	}))
	var audit model.PaymentAudit
	require.NoError(t, model.DB.Where("order_no = ?", order.OrderNo).First(&audit).Error)
	require.Equal(t, "admin", audit.ActorType)
	require.Equal(t, 99, audit.ActorId)
	require.Equal(t, "manual verification", audit.Reason)
}

func TestStripeQuoteUsesDecimalConfigurationWithoutFloatArithmetic(t *testing.T) {
	payment := operation_setting.GetPaymentSetting()
	originalOptions := payment.AmountOptions
	originalDiscounts := payment.AmountDiscount
	originalText := setting.StripeUnitPriceText
	originalFloat := setting.StripeUnitPrice
	t.Cleanup(func() {
		payment.AmountOptions = originalOptions
		payment.AmountDiscount = originalDiscounts
		setting.StripeUnitPriceText = originalText
		setting.StripeUnitPrice = originalFloat
	})
	payment.AmountOptions = []int{1, 2, 10}
	payment.AmountDiscount = map[int]float64{}

	require.NoError(t, setting.SetStripeUnitPrice("0.1"))
	quote, err := buildStripeTopUpQuote(2, "default")
	require.NoError(t, err)
	require.Equal(t, int64(20), quote.AmountMinor)

	require.NoError(t, setting.SetStripeUnitPrice("0.2"))
	quote, err = buildStripeTopUpQuote(1, "default")
	require.NoError(t, err)
	require.Equal(t, int64(20), quote.AmountMinor)

	require.Error(t, setting.SetStripeUnitPrice("0.12345"))
	require.Error(t, setting.SetStripeUnitPrice("-1"))
}

func TestStripeQuoteRejectsOverflow(t *testing.T) {
	payment := operation_setting.GetPaymentSetting()
	originalOptions := payment.AmountOptions
	originalText := setting.StripeUnitPriceText
	originalFloat := setting.StripeUnitPrice
	t.Cleanup(func() {
		payment.AmountOptions = originalOptions
		setting.StripeUnitPriceText = originalText
		setting.StripeUnitPrice = originalFloat
	})
	huge := int(^uint(0) >> 1)
	payment.AmountOptions = []int{huge}
	require.NoError(t, setting.SetStripeUnitPrice("8"))
	_, err := buildStripeTopUpQuote(int64(huge), "default")
	require.Error(t, err)
}

func TestStripeWebhookSourceDoesNotLogSecretsOrRawPayload(t *testing.T) {
	source, err := os.ReadFile("topup_stripe.go")
	require.NoError(t, err)
	text := string(source)
	for _, forbidden := range []string{
		`string(payload)`,
		`signature=%q`,
		`body=%q`,
	} {
		require.NotContains(t, text, forbidden)
	}
}
