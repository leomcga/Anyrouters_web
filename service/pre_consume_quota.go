package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func ReturnPreConsumedQuota(c *gin.Context, relayInfo *relaycommon.RelayInfo) {
	if relayInfo == nil || relayInfo.FinalPreConsumedQuota == 0 {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("用户 %d 请求失败, 返还预扣费额度 %s", relayInfo.UserId, logger.FormatQuota(relayInfo.FinalPreConsumedQuota)))
	if relayInfo.Billing != nil {
		relayInfo.Billing.Refund(c)
		return
	}
	if _, err := model.RefundBillingRequest(relayInfo.RequestId); err != nil {
		if _, queueErr := model.QueueBillingJob(
			relayInfo.RequestId,
			model.BillingJobOperationRefund,
			0,
			err.Error(),
		); queueErr != nil {
			common.SysLog(fmt.Sprintf(
				"billing refund failed without session: request_id=%s user_id=%d error=%s queue_error=%s",
				relayInfo.RequestId,
				relayInfo.UserId,
				model.SanitizeBillingError(err.Error()),
				model.SanitizeBillingError(queueErr.Error()),
			))
		}
	}
}

// PreConsumeQuota checks if the user has enough quota to pre-consume.
// It returns the pre-consumed quota if successful, or an error if not.
func PreConsumeQuota(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	return PreConsumeBilling(c, preConsumedQuota, relayInfo)
}
