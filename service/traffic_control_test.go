package service

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type trafficConfigSnapshot struct {
	userRPM, keyRPM, ipRPM, modelRPM, channelRPM    int64
	userTPM, keyTPM, ipTPM, modelTPM, channelTPM    int64
	userCC, keyCC, ipCC, modelCC, channelCC         int64
	userDailyTokens, keyDailyTokens, userDailyQuota int64
	enabled                                         bool
}

func setTrafficTestConfig(t *testing.T) {
	t.Helper()
	snapshot := trafficConfigSnapshot{
		common.TrafficUserRPMLimit, common.TrafficKeyRPMLimit, common.TrafficIPRPMLimit,
		common.TrafficModelRPMLimit, common.TrafficChannelRPMLimit,
		common.TrafficUserTPMLimit, common.TrafficKeyTPMLimit, common.TrafficIPTPMLimit,
		common.TrafficModelTPMLimit, common.TrafficChannelTPMLimit,
		common.TrafficUserMaxConcurrent, common.TrafficKeyMaxConcurrent, common.TrafficIPMaxConcurrent,
		common.TrafficModelMaxConcurrent, common.TrafficChannelMaxConcurrent,
		common.TrafficUserDailyTokenLimit, common.TrafficKeyDailyTokenLimit, common.TrafficUserDailyQuotaLimit,
		common.TrafficControlEnabled,
	}
	common.TrafficControlEnabled = true
	common.TrafficUserRPMLimit = 1_000_000
	common.TrafficKeyRPMLimit = 1_000_000
	common.TrafficIPRPMLimit = 1_000_000
	common.TrafficModelRPMLimit = 1_000_000
	common.TrafficChannelRPMLimit = 1_000_000
	common.TrafficUserTPMLimit = 1_000_000
	common.TrafficKeyTPMLimit = 1_000_000
	common.TrafficIPTPMLimit = 1_000_000
	common.TrafficModelTPMLimit = 1_000_000
	common.TrafficChannelTPMLimit = 1_000_000
	common.TrafficUserMaxConcurrent = 1_000
	common.TrafficKeyMaxConcurrent = 1_000
	common.TrafficIPMaxConcurrent = 1_000
	common.TrafficModelMaxConcurrent = 1_000
	common.TrafficChannelMaxConcurrent = 1_000
	common.TrafficUserDailyTokenLimit = 1_000_000
	common.TrafficKeyDailyTokenLimit = 1_000_000
	common.TrafficUserDailyQuotaLimit = 1_000_000
	t.Cleanup(func() {
		common.TrafficUserRPMLimit, common.TrafficKeyRPMLimit, common.TrafficIPRPMLimit =
			snapshot.userRPM, snapshot.keyRPM, snapshot.ipRPM
		common.TrafficModelRPMLimit, common.TrafficChannelRPMLimit = snapshot.modelRPM, snapshot.channelRPM
		common.TrafficUserTPMLimit, common.TrafficKeyTPMLimit, common.TrafficIPTPMLimit =
			snapshot.userTPM, snapshot.keyTPM, snapshot.ipTPM
		common.TrafficModelTPMLimit, common.TrafficChannelTPMLimit = snapshot.modelTPM, snapshot.channelTPM
		common.TrafficUserMaxConcurrent, common.TrafficKeyMaxConcurrent, common.TrafficIPMaxConcurrent =
			snapshot.userCC, snapshot.keyCC, snapshot.ipCC
		common.TrafficModelMaxConcurrent, common.TrafficChannelMaxConcurrent = snapshot.modelCC, snapshot.channelCC
		common.TrafficUserDailyTokenLimit, common.TrafficKeyDailyTokenLimit =
			snapshot.userDailyTokens, snapshot.keyDailyTokens
		common.TrafficUserDailyQuotaLimit = snapshot.userDailyQuota
		common.TrafficControlEnabled = snapshot.enabled
	})
}

func trafficTestRequest(ip string, userID int, key string, model string, channelID int) (*gin.Context, *relaycommon.RelayInfo) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	ctx.Request.RemoteAddr = ip + ":1234"
	common.SetContextKey(ctx, constant.ContextKeyFinalModel, model)
	return ctx, &relaycommon.RelayInfo{
		UserId:          userID,
		TokenKey:        key,
		OriginModelName: model,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
	}
}

func TestThreeInstancesShareRPMAndTPM(t *testing.T) {
	setTrafficTestConfig(t)
	backend := newMemoryTrafficBackend()
	common.TrafficUserRPMLimit = 2
	common.TrafficUserTPMLimit = 100

	for i := 0; i < 2; i++ {
		ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
		lease, err := acquireTrafficLimitsWithBackend(ctx, info, 40, 10, backend, false)
		require.NoError(t, err)
		lease.Close(true)
	}
	ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	_, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 10, backend, false)
	var limitErr *TrafficLimitError
	require.ErrorAs(t, err, &limitErr)
	require.Equal(t, "rpm:user", limitErr.Dimension)

	backend = newMemoryTrafficBackend()
	common.TrafficUserRPMLimit = 100
	for i := 0; i < 2; i++ {
		ctx, info = trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
		lease, err := acquireTrafficLimitsWithBackend(ctx, info, 40, 10, backend, false)
		require.NoError(t, err)
		lease.Close(true)
	}
	ctx, info = trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	_, err = acquireTrafficLimitsWithBackend(ctx, info, 30, 10, backend, false)
	require.ErrorAs(t, err, &limitErr)
	require.Equal(t, "tpm:user", limitErr.Dimension)
}

func TestTrafficDimensionsAndSharedIdentities(t *testing.T) {
	tests := []struct {
		name     string
		setLimit func()
		second   func() (*gin.Context, *relaycommon.RelayInfo)
		want     string
	}{
		{"user", func() { common.TrafficUserRPMLimit = 1 }, func() (*gin.Context, *relaycommon.RelayInfo) {
			return trafficTestRequest("203.0.113.2", 1, "key-b", "model-b", 2)
		}, "rpm:user"},
		{"key across IPs", func() { common.TrafficKeyRPMLimit = 1 }, func() (*gin.Context, *relaycommon.RelayInfo) {
			return trafficTestRequest("203.0.113.9", 2, "key-a", "model-b", 2)
		}, "rpm:key"},
		{"ip across keys", func() { common.TrafficIPRPMLimit = 1 }, func() (*gin.Context, *relaycommon.RelayInfo) {
			return trafficTestRequest("203.0.113.1", 2, "key-b", "model-b", 2)
		}, "rpm:ip"},
		{"model", func() { common.TrafficModelRPMLimit = 1 }, func() (*gin.Context, *relaycommon.RelayInfo) {
			return trafficTestRequest("203.0.113.2", 2, "key-b", "model-a", 2)
		}, "rpm:model"},
		{"channel", func() { common.TrafficChannelRPMLimit = 1 }, func() (*gin.Context, *relaycommon.RelayInfo) {
			return trafficTestRequest("203.0.113.2", 2, "key-b", "model-b", 1)
		}, "rpm:channel"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setTrafficTestConfig(t)
			test.setLimit()
			backend := newMemoryTrafficBackend()
			ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
			lease, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, backend, false)
			require.NoError(t, err)
			lease.Close(true)
			ctx, info = test.second()
			_, err = acquireTrafficLimitsWithBackend(ctx, info, 10, 1, backend, false)
			var limitErr *TrafficLimitError
			require.ErrorAs(t, err, &limitErr)
			require.Equal(t, test.want, limitErr.Dimension)
		})
	}
}

func TestConcurrencyReleaseAndCountersNeverNegative(t *testing.T) {
	setTrafficTestConfig(t)
	common.TrafficKeyMaxConcurrent = 1
	backend := newMemoryTrafficBackend()
	ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	first, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, backend, false)
	require.NoError(t, err)

	ctx2, info2 := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	_, err = acquireTrafficLimitsWithBackend(ctx2, info2, 10, 1, backend, false)
	var limitErr *TrafficLimitError
	require.ErrorAs(t, err, &limitErr)
	require.Equal(t, "concurrent:key", limitErr.Dimension)

	first.Close(false)
	first.Close(false)
	ctx3, info3 := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	next, err := acquireTrafficLimitsWithBackend(ctx3, info3, 10, 1, backend, false)
	require.NoError(t, err)
	next.Close(true)
	for key, value := range backend.values {
		require.GreaterOrEqual(t, value.value, int64(0), key)
	}
}

func TestConcurrencyReleasesForSSEDisconnectAndTimeout(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		success bool
	}{
		{name: "sse normal end", success: true},
		{name: "client disconnect", success: false},
		{name: "upstream timeout", success: false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			setTrafficTestConfig(t)
			common.TrafficKeyMaxConcurrent = 1
			backend := newMemoryTrafficBackend()
			ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
			lease, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, backend, false)
			require.NoError(t, err)
			lease.Close(scenario.success)

			ctx, info = trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
			next, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, backend, false)
			require.NoError(t, err)
			next.Close(false)
		})
	}
}

func TestDailyTokenAndQuotaReservationsAdjustToActual(t *testing.T) {
	setTrafficTestConfig(t)
	common.TrafficUserDailyTokenLimit = 100
	common.TrafficKeyDailyTokenLimit = 100
	common.TrafficUserDailyQuotaLimit = 100
	backend := newMemoryTrafficBackend()
	ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	first, err := acquireTrafficLimitsWithBackend(ctx, info, 60, 60, backend, false)
	require.NoError(t, err)
	first.Commit(20, 20)
	first.Close(true)

	ctx2, info2 := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	second, err := acquireTrafficLimitsWithBackend(ctx2, info2, 70, 70, backend, false)
	require.NoError(t, err)
	second.Close(false)

	ctx3, info3 := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	third, err := acquireTrafficLimitsWithBackend(ctx3, info3, 80, 80, backend, false)
	require.NoError(t, err)
	third.Close(true)
}

type failingTrafficBackend struct{}

func (failingTrafficBackend) Acquire(context.Context, []trafficLimitEntry) (bool, int, int64, error) {
	return false, -1, 0, errors.New("redis unavailable")
}
func (failingTrafficBackend) Release(context.Context, trafficLimitEntry, int64) error {
	return errors.New("redis unavailable")
}

func TestHighRiskTrafficFailsClosedWhenBackendUnavailable(t *testing.T) {
	setTrafficTestConfig(t)
	ctx, info := trafficTestRequest("203.0.113.1", 1, "key-a", "model-a", 1)
	_, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, failingTrafficBackend{}, false)
	require.Error(t, err)

	recovered := newMemoryTrafficBackend()
	lease, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, recovered, false)
	require.NoError(t, err)
	lease.Close(false)
}

func TestTrafficKeysContainOnlyDigestedIdentities(t *testing.T) {
	setTrafficTestConfig(t)
	backend := newMemoryTrafficBackend()
	const rawKey = "ak_public_secret-that-must-not-enter-redis"
	const rawIP = "203.0.113.77"
	ctx, info := trafficTestRequest(rawIP, 1, rawKey, "private-model-name", 1)
	lease, err := acquireTrafficLimitsWithBackend(ctx, info, 10, 1, backend, false)
	require.NoError(t, err)
	for key := range backend.values {
		require.NotContains(t, key, rawKey)
		require.NotContains(t, key, rawIP)
	}
	lease.Close(false)
}
