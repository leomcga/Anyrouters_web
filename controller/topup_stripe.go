package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
	"github.com/stripe/stripe-go/v81/paymentintent"
	"github.com/stripe/stripe-go/v81/webhook"
)

const stripeWebhookTolerance = 5 * time.Minute

var (
	stripeGetCheckoutSession = session.Get
	stripeGetPaymentIntent   = paymentintent.Get
)

var stripeAdaptor = &StripeAdaptor{}

type StripePayRequest struct {
	Amount        int64  `json:"amount"`
	PaymentMethod string `json:"payment_method"`
	// Kept for request compatibility. Redirect targets are always generated
	// server-side and these values are intentionally ignored.
	SuccessURL string `json:"success_url,omitempty"`
	CancelURL  string `json:"cancel_url,omitempty"`
}

type StripeAdaptor struct{}

type stripeTopUpQuote struct {
	AmountMinor  int64
	Currency     string
	CreditQuota  int64
	DisplayMoney string
	Snapshot     string
	Version      string
}

func decimalFromConfiguredFloat(value float64) decimal.Decimal {
	text := strconv.FormatFloat(value, 'f', -1, 64)
	result, err := decimal.NewFromString(text)
	if err != nil {
		return decimal.Zero
	}
	return result
}

func allowedStripeTopUpAmount(amount int64) bool {
	for _, option := range operation_setting.GetPaymentSetting().AmountOptions {
		if int64(option) == amount {
			return true
		}
	}
	return false
}

func buildStripeTopUpQuote(amount int64, group string) (*stripeTopUpQuote, error) {
	if amount <= 0 || !allowedStripeTopUpAmount(amount) {
		return nil, errors.New("请选择系统提供的充值档位")
	}
	requested := decimal.NewFromInt(amount)
	quotaPerUnit := decimalFromConfiguredFloat(common.QuotaPerUnit)
	if !quotaPerUnit.IsPositive() {
		return nil, errors.New("充值额度换算配置无效")
	}
	creditQuota := requested.Mul(quotaPerUnit)
	baseUnits := requested
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		creditQuota = requested
		baseUnits = requested.Div(quotaPerUnit)
	}
	if !creditQuota.IsPositive() || !creditQuota.Equal(creditQuota.Truncate(0)) {
		return nil, errors.New("充值额度配置无法精确换算")
	}

	ratio := decimalFromConfiguredFloat(common.GetTopupGroupRatio(group))
	if !ratio.IsPositive() {
		ratio = decimal.NewFromInt(1)
	}
	discount := decimal.NewFromInt(1)
	if configured, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amount)]; ok && configured > 0 {
		discount = decimalFromConfiguredFloat(configured)
	}
	unitPrice, err := decimal.NewFromString(setting.StripeUnitPriceText)
	if err != nil {
		return nil, errors.New("Stripe 支付单价配置无效")
	}
	totalMinor := baseUnits.Mul(unitPrice).Mul(ratio).Mul(discount).
		Mul(decimal.NewFromInt(100)).Round(0)
	if !totalMinor.IsPositive() || !totalMinor.Equal(totalMinor.Truncate(0)) {
		return nil, errors.New("Stripe 支付金额配置无效")
	}
	maxInt64 := decimal.NewFromInt(int64(^uint64(0) >> 1))
	if totalMinor.GreaterThan(maxInt64) || creditQuota.GreaterThan(maxInt64) {
		return nil, errors.New("Stripe 支付金额超出系统范围")
	}

	snapshot := map[string]interface{}{
		"requested_amount": amount,
		"quota_display":    operation_setting.GetQuotaDisplayType(),
		"unit_price":       unitPrice.String(),
		"group_ratio":      ratio.String(),
		"discount":         discount.String(),
		"currency":         "usd",
		"amount_minor":     totalMinor.IntPart(),
		"credited_quota":   creditQuota.IntPart(),
	}
	snapshotJSON, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(snapshotJSON)
	return &stripeTopUpQuote{
		AmountMinor:  totalMinor.IntPart(),
		Currency:     "usd",
		CreditQuota:  creditQuota.IntPart(),
		DisplayMoney: totalMinor.Div(decimal.NewFromInt(100)).StringFixed(2),
		Snapshot:     string(snapshotJSON),
		Version:      hex.EncodeToString(digest[:8]),
	}, nil
}

func (*StripeAdaptor) RequestAmount(c *gin.Context, req *StripePayRequest) {
	group, err := model.GetUserGroup(c.GetInt("id"), true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	quote, err := buildStripeTopUpQuote(req.Amount, group)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "error", "data": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": quote.DisplayMoney})
}

func (*StripeAdaptor) RequestPay(c *gin.Context, req *StripePayRequest) {
	if req.PaymentMethod != model.PaymentMethodStripe {
		c.JSON(http.StatusBadRequest, gin.H{"message": "error", "data": "不支持的支付渠道"})
		return
	}
	if err := validateStripeRuntimeConfiguration(); err != nil {
		logger.LogWarn(c.Request.Context(), "stripe checkout unavailable: "+err.Error())
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "error", "data": "Stripe 支付暂不可用"})
		return
	}
	userID := c.GetInt("id")
	user, err := model.GetUserById(userID, false)
	if err != nil || user == nil {
		common.ApiErrorMsg(c, "用户不存在")
		return
	}
	quote, err := buildStripeTopUpQuote(req.Amount, user.Group)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "error", "data": err.Error()})
		return
	}
	successURL, cancelURL, err := stripeCheckoutURLs(
		paymentReturnPath("/console/log"),
		paymentReturnPath("/console/topup"),
	)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "error", "data": "Stripe 回跳地址配置无效"})
		return
	}
	order := &model.StripePaymentOrder{
		OrderKind:             model.StripeOrderKindTopUp,
		UserId:                userID,
		ExpectedAmountMinor:   quote.AmountMinor,
		Currency:              quote.Currency,
		CreditedQuota:         quote.CreditQuota,
		Livemode:              stripeConfiguredLivemode(),
		PriceConfigVersion:    quote.Version,
		PriceSnapshot:         quote.Snapshot,
		StripeCustomerId:      user.StripeCustomer,
		CheckoutCustomerEmail: user.Email,
		CheckoutSuccessUrl:    successURL,
		CheckoutCancelUrl:     cancelURL,
	}
	legacyMoney := decimal.NewFromInt(quote.CreditQuota).
		Div(decimalFromConfiguredFloat(common.QuotaPerUnit)).InexactFloat64()
	topUp := &model.TopUp{
		Amount:          req.Amount,
		Money:           legacyMoney,
		PaymentMethod:   model.PaymentMethodStripe,
		PaymentProvider: model.PaymentProviderStripe,
		CreateTime:      common.GetTimestamp(),
		Status:          common.TopUpStatusPending,
	}
	if err := model.CreateStripeTopUpOrder(order, topUp); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("stripe order create failed user_id=%d error=%q", userID, model.SanitizeBillingError(err.Error())))
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "error", "data": "创建支付订单失败"})
		return
	}

	checkout, err := service.CreateAndBindStripeCheckout(order)
	if err != nil {
		_ = model.MarkStripeCheckoutBindingFailed(order.OrderNo, err)
		logger.LogError(c.Request.Context(), fmt.Sprintf("stripe checkout create failed order=%s error=%q", order.OrderNo, model.SanitizeBillingError(err.Error())))
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "error", "data": "拉起支付失败"})
		return
	}
	logger.LogInfo(c.Request.Context(), fmt.Sprintf("stripe checkout created user_id=%d order=%s session=%s amount_minor=%d currency=%s", userID, order.OrderNo, checkout.ID, quote.AmountMinor, quote.Currency))
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{"pay_link": checkout.URL}})
}

func RequestStripeAmount(c *gin.Context) {
	var req StripePayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	stripeAdaptor.RequestAmount(c, &req)
}

func RequestStripePay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req StripePayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	stripeAdaptor.RequestPay(c, &req)
}

func StripeWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	if !isStripeWebhookConfigured() {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	payload, ok := middleware.AnonymousRequestBody(c)
	if !ok {
		logger.LogError(ctx, "stripe webhook rejected because request body limit middleware did not run")
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	signature := c.GetHeader("Stripe-Signature")
	event, err := webhook.ConstructEventWithOptions(payload, signature, setting.StripeWebhookSecret, webhook.ConstructEventOptions{
		Tolerance: stripeWebhookTolerance,
	})
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("stripe webhook signature rejected body_bytes=%d error=%q", len(payload), safeStripeError(err)))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	if stripeProductionMode() && !event.Livemode {
		logger.LogWarn(ctx, fmt.Sprintf("stripe webhook rejected test event in production event_id=%s event_type=%s", event.ID, event.Type))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	incoming, category, err := normalizeStripeWebhookEvent(event, payload)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("stripe webhook body rejected event_id=%s event_type=%s error=%q", event.ID, event.Type, safeStripeError(err)))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	persisted, _, err := model.RecordStripeWebhookEvent(incoming)
	if errors.Is(err, model.ErrStripeEventConflict) {
		c.Status(http.StatusOK)
		return
	}
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("stripe webhook persist failed event_id=%s event_type=%s error=%q", event.ID, event.Type, model.SanitizeBillingError(err.Error())))
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	if persisted.Status == model.StripeEventStatusProcessed ||
		persisted.Status == model.StripeEventStatusIgnored ||
		persisted.Status == model.StripeEventStatusRejected ||
		persisted.Status == model.StripeEventStatusManualReview {
		c.Status(http.StatusOK)
		return
	}
	if category == "success" {
		if err := model.MarkStripeOrderPaidPending(incoming.OrderNo, event.ID); err != nil {
			_ = model.MarkStripeEventRetry(event.ID, err)
			c.AbortWithStatus(http.StatusServiceUnavailable)
			return
		}
	}

	var processErr error
	switch category {
	case "success":
		_, processErr = model.ProcessStripeSuccessfulEvent(event.ID)
	case "pending":
		_, processErr = model.ProcessStripeSuccessfulEvent(event.ID)
	case "failure":
		processErr = model.ProcessStripeFailureEvent(event.ID, false)
	case "refund":
		processErr = model.ProcessStripeFailureEvent(event.ID, true)
	default:
		processErr = model.MarkStripeEventIgnored(event.ID)
	}
	if processErr != nil {
		_ = model.MarkStripeEventRetry(event.ID, processErr)
		_ = model.MarkStripeOrderCreditRetry(incoming.OrderNo, event.ID, processErr)
		logger.LogError(ctx, fmt.Sprintf("stripe webhook processing failed event_id=%s event_type=%s error=%q", event.ID, event.Type, model.SanitizeBillingError(processErr.Error())))
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("stripe webhook processed event_id=%s event_type=%s category=%s", event.ID, event.Type, category))
	c.Status(http.StatusOK)
}

func normalizeStripeWebhookEvent(event stripe.Event, payload []byte) (*model.StripeWebhookEvent, string, error) {
	digest := sha256.Sum256(payload)
	result := &model.StripeWebhookEvent{
		StripeEventId: event.ID,
		EventType:     string(event.Type),
		ApiVersion:    event.APIVersion,
		Livemode:      event.Livemode,
		PayloadDigest: hex.EncodeToString(digest[:]),
	}
	switch event.Type {
	case stripe.EventTypeCheckoutSessionCompleted,
		stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded,
		stripe.EventTypeCheckoutSessionAsyncPaymentFailed,
		stripe.EventTypeCheckoutSessionExpired:
		var checkout stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &checkout); err != nil {
			return nil, "", err
		}
		result.OrderNo = firstNonEmptyString(checkout.Metadata["order_no"], checkout.ClientReferenceID)
		result.StripeObjectId = checkout.ID
		result.CheckoutSessionId = checkout.ID
		result.AmountMinor = checkout.AmountTotal
		result.Currency = string(checkout.Currency)
		result.PaymentStatus = string(checkout.PaymentStatus)
		if checkout.PaymentIntent != nil {
			result.PaymentIntentId = checkout.PaymentIntent.ID
		}
		if checkout.Customer != nil {
			result.CustomerId = checkout.Customer.ID
		}
		switch event.Type {
		case stripe.EventTypeCheckoutSessionCompleted:
			if result.PaymentStatus != "paid" {
				return result, "pending", nil
			}
			return result, "success", nil
		case stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded:
			result.PaymentStatus = "paid"
			return result, "success", nil
		default:
			return result, "failure", nil
		}
	case stripe.EventTypePaymentIntentSucceeded:
		var intent stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &intent); err != nil {
			return nil, "", err
		}
		result.OrderNo = intent.Metadata["order_no"]
		result.StripeObjectId = intent.ID
		result.PaymentIntentId = intent.ID
		result.AmountMinor = intent.AmountReceived
		result.Currency = string(intent.Currency)
		result.PaymentStatus = string(intent.Status)
		if intent.Customer != nil {
			result.CustomerId = intent.Customer.ID
		}
		return result, "success", nil
	case stripe.EventTypePaymentIntentPaymentFailed, stripe.EventTypePaymentIntentCanceled:
		var intent stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &intent); err != nil {
			return nil, "", err
		}
		result.OrderNo = intent.Metadata["order_no"]
		result.StripeObjectId = intent.ID
		result.PaymentIntentId = intent.ID
		result.AmountMinor = intent.Amount
		result.Currency = string(intent.Currency)
		result.PaymentStatus = string(intent.Status)
		return result, "failure", nil
	case stripe.EventTypeChargeRefunded:
		var charge stripe.Charge
		if err := json.Unmarshal(event.Data.Raw, &charge); err != nil {
			return nil, "", err
		}
		result.OrderNo = charge.Metadata["order_no"]
		result.StripeObjectId = charge.ID
		result.AmountMinor = charge.Amount
		result.Currency = string(charge.Currency)
		return result, "refund", nil
	default:
		result.StripeObjectId = event.GetObjectValue("id")
		return result, "ignored", nil
	}
}

func RepairStripePaymentOrder(orderNo, stripeObjectID string, actor model.StripePaymentActor) error {
	if orderNo == "" || stripeObjectID == "" {
		return errors.New("必须提供本地订单号和 Stripe 对象 ID")
	}
	if err := validateStripeRuntimeConfiguration(); err != nil {
		return err
	}
	stripe.Key = setting.StripeApiSecret
	var incoming *model.StripeWebhookEvent
	if strings.HasPrefix(stripeObjectID, "cs_") {
		checkout, err := stripeGetCheckoutSession(stripeObjectID, &stripe.CheckoutSessionParams{})
		if err != nil {
			return errors.New("Stripe 查询支付对象失败")
		}
		paymentIntentID := ""
		customerID := ""
		if checkout.PaymentIntent != nil {
			paymentIntentID = checkout.PaymentIntent.ID
		}
		if checkout.Customer != nil {
			customerID = checkout.Customer.ID
		}
		incoming = &model.StripeWebhookEvent{
			StripeEventId:     "admin_repair:" + checkout.ID,
			EventType:         "admin.checkout.repair",
			ApiVersion:        stripe.APIVersion,
			Livemode:          checkout.Livemode,
			OrderNo:           firstNonEmptyString(checkout.Metadata["order_no"], checkout.ClientReferenceID),
			StripeObjectId:    checkout.ID,
			CheckoutSessionId: checkout.ID,
			PaymentIntentId:   paymentIntentID,
			CustomerId:        customerID,
			AmountMinor:       checkout.AmountTotal,
			Currency:          string(checkout.Currency),
			PaymentStatus:     string(checkout.PaymentStatus),
		}
	} else if strings.HasPrefix(stripeObjectID, "pi_") {
		intent, err := stripeGetPaymentIntent(stripeObjectID, &stripe.PaymentIntentParams{})
		if err != nil {
			return errors.New("Stripe 查询支付对象失败")
		}
		customerID := ""
		if intent.Customer != nil {
			customerID = intent.Customer.ID
		}
		incoming = &model.StripeWebhookEvent{
			StripeEventId:   "admin_repair:" + intent.ID,
			EventType:       "admin.payment_intent.repair",
			ApiVersion:      stripe.APIVersion,
			Livemode:        intent.Livemode,
			OrderNo:         intent.Metadata["order_no"],
			StripeObjectId:  intent.ID,
			PaymentIntentId: intent.ID,
			CustomerId:      customerID,
			AmountMinor:     intent.AmountReceived,
			Currency:        string(intent.Currency),
			PaymentStatus:   string(intent.Status),
		}
	} else {
		return errors.New("仅支持 Checkout Session 或 Payment Intent")
	}
	if incoming.OrderNo != orderNo {
		return errors.New("Stripe 对象与本地订单号不一致")
	}
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d|%s|%s", incoming.StripeEventId, orderNo, incoming.AmountMinor, incoming.Currency, incoming.PaymentStatus)))
	incoming.PayloadDigest = hex.EncodeToString(digest[:])
	if _, _, err := model.RecordStripeWebhookEvent(incoming); err != nil && !errors.Is(err, model.ErrStripeEventConflict) {
		return err
	}
	_, err := model.ProcessStripeSuccessfulEventWithActor(incoming.StripeEventId, actor)
	return err
}

func validateStripeRuntimeConfiguration() error {
	secret := strings.TrimSpace(setting.StripeApiSecret)
	if !strings.HasPrefix(secret, "sk_test_") && !strings.HasPrefix(secret, "sk_live_") && !strings.HasPrefix(secret, "rk_test_") && !strings.HasPrefix(secret, "rk_live_") {
		return errors.New("Stripe API 密钥未配置")
	}
	if strings.TrimSpace(setting.StripeWebhookSecret) == "" {
		return errors.New("Stripe Webhook Secret 未配置")
	}
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if (env == "production" || env == "prod") && !stripeConfiguredLivemode() {
		return errors.New("生产环境禁止使用 Stripe 测试密钥")
	}
	return nil
}

func stripeCheckoutURLs(defaultSuccess, defaultCancel string) (string, string, error) {
	successURL := strings.TrimSpace(setting.StripeSuccessURL)
	cancelURL := strings.TrimSpace(setting.StripeCancelURL)
	if successURL == "" {
		successURL = defaultSuccess
	} else if err := common.ValidateRedirectURL(successURL); err != nil {
		return "", "", err
	}
	if cancelURL == "" {
		cancelURL = defaultCancel
	} else if err := common.ValidateRedirectURL(cancelURL); err != nil {
		return "", "", err
	}
	return successURL, cancelURL, nil
}

func stripeConfiguredLivemode() bool {
	secret := strings.TrimSpace(setting.StripeApiSecret)
	return strings.HasPrefix(secret, "sk_live_") || strings.HasPrefix(secret, "rk_live_")
}

func stripeProductionMode() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	return env == "production" || env == "prod"
}

func safeStripeError(err error) string {
	if err == nil {
		return ""
	}
	text := strings.ToLower(err.Error())
	switch {
	case strings.Contains(text, "signature"):
		return "invalid signature"
	case strings.Contains(text, "timestamp"), strings.Contains(text, "too old"):
		return "expired signature"
	case strings.Contains(text, "json"):
		return "invalid webhook json"
	case strings.Contains(text, "api version"):
		return "incompatible api version"
	default:
		return "stripe webhook rejected"
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func getStripeMinTopup() int64 {
	return int64(setting.StripeMinTopUp)
}
