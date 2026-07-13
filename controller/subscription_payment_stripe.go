package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type SubscriptionStripePayRequest struct {
	PlanId int `json:"plan_id"`
}

func SubscriptionRequestStripePay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req SubscriptionStripePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.StripePriceId == "" {
		common.ApiErrorMsg(c, "该套餐未配置 StripePriceId")
		return
	}
	if !strings.HasPrefix(setting.StripeApiSecret, "sk_") && !strings.HasPrefix(setting.StripeApiSecret, "rk_") {
		common.ApiErrorMsg(c, "Stripe 未配置或密钥无效")
		return
	}
	if setting.StripeWebhookSecret == "" {
		common.ApiErrorMsg(c, "Stripe Webhook 未配置")
		return
	}

	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if user == nil {
		common.ApiErrorMsg(c, "用户不存在")
		return
	}

	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	price := decimalFromConfiguredFloat(plan.PriceAmount)
	expectedMinor := price.Mul(decimal.NewFromInt(100)).Round(0)
	if !expectedMinor.IsPositive() || !expectedMinor.Equal(expectedMinor.Truncate(0)) {
		common.ApiErrorMsg(c, "套餐价格配置无效")
		return
	}
	currency := strings.ToLower(strings.TrimSpace(plan.Currency))
	if currency == "" {
		currency = "usd"
	}
	snapshotBytes, _ := json.Marshal(map[string]interface{}{
		"plan_id":      plan.Id,
		"stripe_price": plan.StripePriceId,
		"amount_minor": expectedMinor.IntPart(),
		"currency":     currency,
		"plan_price":   price.String(),
		"plan_updated": plan.UpdatedAt,
	})
	digest := sha256.Sum256(snapshotBytes)
	successURL, cancelURL, err := stripeCheckoutURLs(
		paymentReturnPath("/console/topup"),
		paymentReturnPath("/console/topup"),
	)
	if err != nil {
		common.ApiErrorMsg(c, "Stripe 回跳地址配置无效")
		return
	}
	paymentOrder := &model.StripePaymentOrder{
		OrderKind:             model.StripeOrderKindSubscription,
		UserId:                userId,
		PlanId:                plan.Id,
		ExpectedAmountMinor:   expectedMinor.IntPart(),
		Currency:              currency,
		CreditedQuota:         0,
		Livemode:              stripeConfiguredLivemode(),
		PriceConfigVersion:    hex.EncodeToString(digest[:8]),
		PriceSnapshot:         string(snapshotBytes),
		StripeCustomerId:      user.StripeCustomer,
		CheckoutCustomerEmail: user.Email,
		StripePriceId:         plan.StripePriceId,
		CheckoutSuccessUrl:    successURL,
		CheckoutCancelUrl:     cancelURL,
	}
	legacyOrder := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           plan.PriceAmount,
		PaymentMethod:   model.PaymentMethodStripe,
		PaymentProvider: model.PaymentProviderStripe,
		CreateTime:      common.GetTimestamp(),
		Status:          common.TopUpStatusPending,
	}
	if err := model.CreateStripeSubscriptionOrder(paymentOrder, legacyOrder); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	checkout, err := service.CreateAndBindStripeCheckout(paymentOrder)
	if err != nil {
		_ = model.MarkStripeCheckoutBindingFailed(paymentOrder.OrderNo, err)
		logger.LogError(c.Request.Context(), fmt.Sprintf("stripe subscription checkout create failed order=%s plan_id=%d error=%q", paymentOrder.OrderNo, plan.Id, model.SanitizeBillingError(err.Error())))
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": "error", "data": "拉起支付失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"pay_link": checkout.URL,
		},
	})
}
