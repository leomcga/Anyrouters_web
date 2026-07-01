package service

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Sandbox (E2B) playground code-execution billing.
//
// Policy: each user gets SANDBOX_FREE_DAILY free executions per UTC day; beyond
// that, each successful execution costs SANDBOX_EXEC_QUOTA quota (charged at
// E2B cost — we don't profit from the sandbox, we only recover the overage).
// Failed executions never count or charge.
//
// Env config (all optional, safe defaults):
//   SANDBOX_BILLING_ENABLED  (bool,  default true)  — master switch; false = unlimited free (pre-billing behavior)
//   SANDBOX_FREE_DAILY       (int,   default 50)    — free executions per user per day
//   SANDBOX_EXEC_QUOTA       (int,   default 100)   — quota charged per over-limit execution ($1 = 500000 quota, so 100 ≈ $0.0002)

const sandboxBillingModelName = "sandbox-exec"

// ErrSandboxQuotaInsufficient is returned by CheckSandboxQuota when the user is
// past the free tier and can't afford another execution. The controller maps
// this to HTTP 402/429 with a user-facing message.
var ErrSandboxQuotaInsufficient = errors.New("sandbox free quota exhausted and insufficient balance")

func sandboxBillingEnabled() bool {
	return common.GetEnvOrDefaultBool("SANDBOX_BILLING_ENABLED", true)
}

func sandboxFreeDaily() int {
	return common.GetEnvOrDefault("SANDBOX_FREE_DAILY", 50)
}

func sandboxExecQuota() int {
	return common.GetEnvOrDefault("SANDBOX_EXEC_QUOTA", 100)
}

// CheckSandboxQuota is called BEFORE running code. If billing is on and the user
// has already used up the free daily allowance, it verifies the user can afford
// the next execution; otherwise returns ErrSandboxQuotaInsufficient so the
// caller can reject before spinning up an E2B sandbox (no wasted cost).
//
// Within the free tier this is a cheap read and always allows.
func CheckSandboxQuota(userId int) error {
	if !sandboxBillingEnabled() {
		return nil
	}
	free := sandboxFreeDaily()
	used, err := model.GetSandboxDailyCount(userId)
	if err != nil {
		// Fail open on counter read errors — never block a legitimate user
		// because of a transient DB hiccup; log for visibility.
		common.SysError(fmt.Sprintf("sandbox: read daily count failed for user %d: %s", userId, err.Error()))
		return nil
	}
	if used < free {
		return nil // still within free tier
	}
	// This execution will be billed — ensure the user can pay for it.
	quota, err := model.GetUserQuota(userId, false)
	if err != nil {
		common.SysError(fmt.Sprintf("sandbox: read user quota failed for user %d: %s", userId, err.Error()))
		return nil // fail open
	}
	if quota < sandboxExecQuota() {
		return ErrSandboxQuotaInsufficient
	}
	return nil
}

// ChargeSandboxExecution is called AFTER a successful execution. It increments
// the user's daily counter and, if the execution is beyond the free tier,
// deducts SANDBOX_EXEC_QUOTA and records a consume log. Never call this for a
// failed execution.
func ChargeSandboxExecution(c *gin.Context, userId int) {
	if !sandboxBillingEnabled() {
		return
	}
	free := sandboxFreeDaily()
	newCount, err := model.IncrAndGetSandboxDailyCount(userId)
	if err != nil {
		// Counter failed — don't charge (we can't be sure of the tier). Log it.
		common.SysError(fmt.Sprintf("sandbox: increment daily count failed for user %d: %s", userId, err.Error()))
		return
	}
	if newCount <= free {
		return // free tier — counted only, no charge
	}

	quota := sandboxExecQuota()
	if quota <= 0 {
		return
	}
	if err := model.DecreaseUserQuota(userId, quota, false); err != nil {
		common.SysError(fmt.Sprintf("sandbox: decrease quota failed for user %d: %s", userId, err.Error()))
		return
	}
	model.UpdateUserUsedQuotaAndRequestCount(userId, quota)

	other := map[string]interface{}{
		"is_sandbox":         true,
		"request_path":       c.Request.URL.Path,
		"sandbox_daily_used": newCount,
		"sandbox_free_daily": free,
	}
	model.RecordConsumeLog(c, userId, model.RecordConsumeLogParams{
		ModelName: sandboxBillingModelName,
		TokenName: c.GetString("token_name"),
		Quota:     quota,
		Content:   fmt.Sprintf("沙箱代码执行，超出每日免费额度（%d/%d），按成本计费", newCount, free),
		Group:     c.GetString("group"),
		Other:     other,
	})
}
