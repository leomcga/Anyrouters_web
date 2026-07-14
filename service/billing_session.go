package service

import (
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// BillingSession — 统一计费会话
// ---------------------------------------------------------------------------

// BillingSession 封装单次请求的预扣费/结算/退款生命周期。
// 实现 relaycommon.BillingSettler 接口。
type BillingSession struct {
	relayInfo        *relaycommon.RelayInfo
	funding          FundingSource
	preConsumedQuota int  // 实际预扣额度（信任用户可能为 0）
	tokenConsumed    int  // 令牌额度实际扣减量
	settled          bool // Settle 全部完成（资金 + 令牌）
	refunded         bool // Refund 已调用
	mu               sync.Mutex
}

// Settle commits wallet/subscription, token, ledger and request state in one transaction.
func (s *BillingSession) Settle(actualQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled {
		return nil
	}
	result, err := model.SettleBillingRequest(s.relayInfo.RequestId, int64(actualQuota))
	if err != nil {
		if _, queueErr := model.QueueBillingJob(
			s.relayInfo.RequestId,
			model.BillingJobOperationSettle,
			int64(actualQuota),
			err.Error(),
		); queueErr != nil {
			return fmt.Errorf("settlement failed: %w; queueing persistent retry failed: %v", err, queueErr)
		}
		return err
	}
	delta := actualQuota - s.preConsumedQuota
	s.preConsumedQuota = int(result.Request.ActualQuota)
	s.tokenConsumed = s.preConsumedQuota
	if s.funding.Source() == BillingSourceSubscription {
		s.relayInfo.SubscriptionPostDelta += int64(delta)
	}
	s.settled = true
	s.syncRelayInfo()
	return nil
}

// Refund performs a synchronous idempotent refund transaction. Failures are
// persisted as retryable jobs before returning to the relay path.
func (s *BillingSession) Refund(c *gin.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled || s.refunded || !s.needsRefundLocked() {
		return
	}

	logger.LogInfo(c, fmt.Sprintf("用户 %d 请求失败, 返还预扣费（token_quota=%s, funding=%s）",
		s.relayInfo.UserId,
		logger.FormatQuota(s.tokenConsumed),
		s.funding.Source(),
	))
	if _, err := model.RefundBillingRequest(s.relayInfo.RequestId); err != nil {
		if _, queueErr := model.QueueBillingJob(
			s.relayInfo.RequestId,
			model.BillingJobOperationRefund,
			0,
			err.Error(),
		); queueErr != nil {
			common.SysLog(fmt.Sprintf(
				"billing refund failed and persistent retry could not be queued: request_id=%s user_id=%d error=%s queue_error=%s",
				s.relayInfo.RequestId,
				s.relayInfo.UserId,
				model.SanitizeBillingError(err.Error()),
				model.SanitizeBillingError(queueErr.Error()),
			))
			return
		}
		common.SysLog(fmt.Sprintf(
			"billing refund queued for retry: request_id=%s user_id=%d error=%s",
			s.relayInfo.RequestId, s.relayInfo.UserId, model.SanitizeBillingError(err.Error()),
		))
	}
	s.refunded = true
}

// NeedsRefund 返回是否存在需要退还的预扣状态。
func (s *BillingSession) NeedsRefund() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsRefundLocked()
}

func (s *BillingSession) needsRefundLocked() bool {
	if s.settled || s.refunded {
		return false
	}
	if s.tokenConsumed > 0 {
		return true
	}
	return s.preConsumedQuota > 0
}

// GetPreConsumedQuota 返回实际预扣的额度。
func (s *BillingSession) GetPreConsumedQuota() int {
	return s.preConsumedQuota
}

func (s *BillingSession) Reserve(targetQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.settled || s.refunded || targetQuota <= s.preConsumedQuota {
		return nil
	}

	result, err := model.ReserveBillingRequest(s.reserveParams(int64(targetQuota)))
	if err != nil {
		return err
	}
	s.applyReserveResult(result)
	s.syncRelayInfo()
	return nil
}

// ---------------------------------------------------------------------------
// PreConsume — 统一数据库预留入口
// ---------------------------------------------------------------------------

// preConsume 执行预扣费：信任检查 -> 令牌预扣 -> 资金来源预扣。
// 任一步骤失败时原子回滚已完成的步骤。
func (s *BillingSession) preConsume(c *gin.Context, quota int) *types.NewAPIError {
	effectiveQuota := quota

	if effectiveQuota > 0 {
		logger.LogInfo(c, fmt.Sprintf("用户 %d 需要预扣费 %s (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(effectiveQuota), s.funding.Source()))
	}

	result, err := model.ReserveBillingRequest(s.reserveParams(int64(effectiveQuota)))
	if err != nil {
		if errors.Is(err, model.ErrNoActiveSubscription) || errors.Is(err, model.ErrSubscriptionQuotaInsufficient) {
			return types.NewErrorWithStatusCode(fmt.Errorf("订阅额度不足或未配置订阅: %s", err.Error()), types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		return walletPreConsumeAPIError(err)
	}
	s.applyReserveResult(result)
	s.syncRelayInfo()
	return nil
}

func walletPreConsumeAPIError(err error) *types.NewAPIError {
	switch {
	case errors.Is(err, model.ErrInsufficientUserQuota):
		return types.NewErrorWithStatusCode(
			err,
			types.ErrorCodeInsufficientUserQuota,
			http.StatusForbidden,
			types.ErrOptionWithSkipRetry(),
			types.ErrOptionWithNoRecordErrorLog(),
		)
	case errors.Is(err, model.ErrInsufficientTokenQuota):
		return types.NewErrorWithStatusCode(
			err,
			types.ErrorCodePreConsumeTokenQuotaFailed,
			http.StatusForbidden,
			types.ErrOptionWithSkipRetry(),
			types.ErrOptionWithNoRecordErrorLog(),
		)
	default:
		return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
}

// syncRelayInfo 将 BillingSession 的状态同步到 RelayInfo 的兼容字段上。
func (s *BillingSession) syncRelayInfo() {
	info := s.relayInfo
	info.FinalPreConsumedQuota = s.preConsumedQuota
	info.BillingSource = s.funding.Source()

	if sub, ok := s.funding.(*SubscriptionFunding); ok {
		info.SubscriptionId = sub.subscriptionId
		info.SubscriptionPreConsumed = sub.preConsumed
		info.SubscriptionPostDelta = 0
		info.SubscriptionAmountTotal = sub.AmountTotal
		info.SubscriptionAmountUsedAfterPreConsume = sub.AmountUsedAfter
		info.SubscriptionPlanId = sub.PlanId
		info.SubscriptionPlanTitle = sub.PlanTitle
	} else {
		info.SubscriptionId = 0
		info.SubscriptionPreConsumed = 0
	}
}

func (s *BillingSession) reserveParams(targetQuota int64) model.BillingReserveParams {
	params := model.BillingReserveParams{
		RequestID:      s.relayInfo.RequestId,
		FundingSource:  s.funding.Source(),
		UserID:         s.relayInfo.UserId,
		TokenID:        s.relayInfo.TokenId,
		TokenKey:       s.relayInfo.TokenKey,
		TokenUnlimited: s.relayInfo.TokenUnlimited,
		TargetQuota:    targetQuota,
		SkipToken:      s.relayInfo.IsPlayground,
	}
	if subscription, ok := s.funding.(*SubscriptionFunding); ok {
		params.SubscriptionID = subscription.subscriptionId
	}
	return params
}

func (s *BillingSession) applyReserveResult(result *model.BillingMutationResult) {
	if result == nil {
		return
	}
	reserved := int(result.Request.ReservedQuota)
	s.preConsumedQuota = reserved
	s.tokenConsumed = reserved
	s.relayInfo.UserQuota = int(result.WalletBefore)
	s.relayInfo.TokenUnlimited = result.Request.TokenUnlimited
	if wallet, ok := s.funding.(*WalletFunding); ok {
		wallet.consumed = reserved
	}
	if subscription, ok := s.funding.(*SubscriptionFunding); ok {
		subscription.subscriptionId = result.Request.SubscriptionId
		subscription.preConsumed = result.Request.ReservedQuota
		subscription.AmountTotal = result.SubscriptionTotal
		subscription.AmountUsedAfter = result.SubscriptionUsed
		if planInfo, err := model.GetSubscriptionPlanInfoByUserSubscriptionId(subscription.subscriptionId); err == nil && planInfo != nil {
			subscription.PlanId = planInfo.PlanId
			subscription.PlanTitle = planInfo.PlanTitle
		}
	}
}

// ---------------------------------------------------------------------------
// NewBillingSession 工厂 — 根据计费偏好创建会话并处理回退
// ---------------------------------------------------------------------------

// NewBillingSession 根据用户计费偏好创建 BillingSession，处理 subscription_first / wallet_first 的回退。
func NewBillingSession(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError) {
	if relayInfo == nil {
		return nil, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	pref := common.NormalizeBillingPreference(relayInfo.UserSetting.BillingPreference)

	// 钱包额度由原子预扣事务校验，避免“先查后扣”的竞态。
	tryWallet := func() (*BillingSession, *types.NewAPIError) {
		session := &BillingSession{
			relayInfo: relayInfo,
			funding:   &WalletFunding{userId: relayInfo.UserId},
		}
		if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	trySubscription := func() (*BillingSession, *types.NewAPIError) {
		subConsume := int64(preConsumedQuota)
		if subConsume <= 0 {
			subConsume = 1
		}
		session := &BillingSession{
			relayInfo: relayInfo,
			funding:   &SubscriptionFunding{},
		}
		// 订阅的零额度请求仍保留 1 个额度，以便建立可恢复的计费请求。
		if apiErr := session.preConsume(c, int(subConsume)); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	switch pref {
	case "subscription_only":
		return trySubscription()
	case "wallet_only":
		return tryWallet()
	case "wallet_first":
		session, err := tryWallet()
		if err != nil {
			if err.GetErrorCode() == types.ErrorCodeInsufficientUserQuota {
				return trySubscription()
			}
			return nil, err
		}
		return session, nil
	case "subscription_first":
		fallthrough
	default:
		hasSub, subCheckErr := model.HasActiveUserSubscription(relayInfo.UserId)
		if subCheckErr != nil {
			return nil, types.NewError(subCheckErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if !hasSub {
			return tryWallet()
		}
		session, apiErr := trySubscription()
		if apiErr != nil {
			if apiErr.GetErrorCode() == types.ErrorCodeInsufficientUserQuota {
				return tryWallet()
			}
			return nil, apiErr
		}
		return session, nil
	}
}
