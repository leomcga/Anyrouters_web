package router

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/webhook"
	"gorm.io/gorm"
)

type observedRequestBody struct {
	reader *bytes.Reader
	closed int
}

func (body *observedRequestBody) Read(p []byte) (int, error) {
	return body.reader.Read(p)
}

func (body *observedRequestBody) Close() error {
	body.closed++
	return nil
}

func setupStripeRouterTest(t *testing.T) (*gin.Engine, *bytes.Buffer) {
	t.Helper()
	originalGinMode := gin.Mode()
	originalWriter := gin.DefaultWriter
	originalErrorWriter := gin.DefaultErrorWriter
	originalUsingSQLite := common.UsingSQLite
	originalUsingMySQL := common.UsingMySQL
	originalUsingPostgreSQL := common.UsingPostgreSQL
	originalRedisEnabled := common.RedisEnabled
	originalRateLimitEnabled := common.GlobalApiRateLimitEnable
	originalBodyLimit := constant.AnonymousRequestBodyLimitKB
	originalDB := model.DB
	originalLogDB := model.LOG_DB
	originalAPISecret := setting.StripeApiSecret
	originalWebhookSecret := setting.StripeWebhookSecret

	gin.SetMode(gin.TestMode)
	var logs bytes.Buffer
	gin.DefaultWriter = &logs
	gin.DefaultErrorWriter = &logs
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	common.RedisEnabled = false
	common.GlobalApiRateLimitEnable = false
	constant.AnonymousRequestBodyLimitKB = 1
	setting.StripeApiSecret = "sk_test_router"
	setting.StripeWebhookSecret = "whsec_router"

	db, err := gorm.Open(sqlite.Open(
		fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_")),
	), &gorm.Config{})
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

	engine := gin.New()
	engine.Use(middleware.RequestId())
	middleware.SetUpLogger(engine)
	SetApiRouter(engine)

	t.Cleanup(func() {
		common.UsingSQLite = originalUsingSQLite
		common.UsingMySQL = originalUsingMySQL
		common.UsingPostgreSQL = originalUsingPostgreSQL
		common.RedisEnabled = originalRedisEnabled
		common.GlobalApiRateLimitEnable = originalRateLimitEnabled
		constant.AnonymousRequestBodyLimitKB = originalBodyLimit
		model.DB = originalDB
		model.LOG_DB = originalLogDB
		setting.StripeApiSecret = originalAPISecret
		setting.StripeWebhookSecret = originalWebhookSecret
		gin.DefaultWriter = originalWriter
		gin.DefaultErrorWriter = originalErrorWriter
		gin.SetMode(originalGinMode)
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	return engine, &logs
}

func signedRouterStripePayload(payload []byte) string {
	return webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
		Payload:   payload,
		Secret:    setting.StripeWebhookSecret,
		Timestamp: time.Now(),
	}).Header
}

func performStripeRouterRequest(engine http.Handler, method string, body io.ReadCloser, signature string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, "/api/stripe/webhook", body)
	if signature != "" {
		request.Header.Set("Stripe-Signature", signature)
	}
	engine.ServeHTTP(recorder, request)
	return recorder
}

func TestStripeWebhookProductionRouterPreservesSignedBodyAndDoesNotLogSecrets(t *testing.T) {
	engine, logs := setupStripeRouterTest(t)
	payload := []byte(fmt.Sprintf(
		`{"id":"evt_router","object":"event","api_version":%q,"type":"customer.created","livemode":false,"data":{"object":{"id":"cus_router"}}}`,
		stripe.APIVersion,
	))
	signature := signedRouterStripePayload(payload)
	body := &observedRequestBody{reader: bytes.NewReader(payload)}

	recorder := performStripeRouterRequest(engine, http.MethodPost, body, signature)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, 1, body.closed)
	require.NotContains(t, logs.String(), string(payload))
	require.NotContains(t, logs.String(), signature)
	var event model.StripeWebhookEvent
	require.NoError(t, model.DB.Where("stripe_event_id = ?", "evt_router").First(&event).Error)
	require.Equal(t, model.StripeEventStatusIgnored, event.Status)
	var ledgerCount int64
	require.NoError(t, model.DB.Model(&model.PaymentCreditLedger{}).Count(&ledgerCount).Error)
	require.Zero(t, ledgerCount)
}

func TestStripeWebhookProductionRouterRejectsChangedAndOversizedBodies(t *testing.T) {
	engine, _ := setupStripeRouterTest(t)
	payload := []byte(fmt.Sprintf(
		`{"id":"evt_router_changed","object":"event","api_version":%q,"type":"customer.created","livemode":false,"data":{"object":{"id":"cus_router"}}}`,
		stripe.APIVersion,
	))
	signature := signedRouterStripePayload(payload)
	changed := append(append([]byte{}, payload...), '\n')

	require.Equal(t, http.StatusBadRequest, performStripeRouterRequest(
		engine, http.MethodPost, io.NopCloser(bytes.NewReader(changed)), signature,
	).Code)
	require.Equal(t, http.StatusRequestEntityTooLarge, performStripeRouterRequest(
		engine, http.MethodPost, io.NopCloser(bytes.NewReader(bytes.Repeat([]byte("x"), 1025))), "unused",
	).Code)
	require.Equal(t, http.StatusNotFound, performStripeRouterRequest(
		engine, http.MethodGet, io.NopCloser(bytes.NewReader(nil)), "",
	).Code)

	var count int64
	require.NoError(t, model.DB.Model(&model.StripeWebhookEvent{}).Count(&count).Error)
	require.Zero(t, count)
}
