package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

var channelCircuitAllowScript = redis.NewScript(`
local now = tonumber(redis.call('TIME')[1])
local values = redis.call('HMGET', KEYS[1], 'failures', 'open_until', 'probes')
local failures = tonumber(values[1] or '0')
local open_until = tonumber(values[2] or '0')
local probes = tonumber(values[3] or '0')
local threshold = tonumber(ARGV[1])
local max_probes = tonumber(ARGV[2])
if open_until > now then
  return {0, open_until - now}
end
if failures >= threshold then
  if probes >= max_probes then
    return {0, 1}
  end
  redis.call('HINCRBY', KEYS[1], 'probes', 1)
  return {1, 0}
end
return {1, 0}
`)

var channelCircuitFailureScript = redis.NewScript(`
local now = tonumber(redis.call('TIME')[1])
local threshold = tonumber(ARGV[1])
local open_seconds = tonumber(ARGV[2])
local severe = tonumber(ARGV[3])
local failures = redis.call('HINCRBY', KEYS[1], 'failures', 1)
local opened = 0
if severe == 1 or failures >= threshold then
  redis.call('HSET', KEYS[1], 'open_until', now + open_seconds, 'probes', 0)
  opened = 1
end
redis.call('EXPIRE', KEYS[1], math.max(open_seconds * 10, 600))
return {failures, opened}
`)

func channelCircuitKey(channelID int) string {
	return fmt.Sprintf("traffic:circuit:channel:%d", channelID)
}

type channelCircuitState struct {
	Failures  int64
	OpenUntil int64
	Probes    int64
}

func evaluateChannelCircuit(state channelCircuitState, now int64, threshold int64, maxProbes int64) (bool, int64, channelCircuitState) {
	if state.OpenUntil > now {
		return false, state.OpenUntil - now, state
	}
	if state.Failures >= threshold {
		if state.Probes >= maxProbes {
			return false, 1, state
		}
		state.Probes++
	}
	return true, 0, state
}

func applyChannelCircuitFailure(state channelCircuitState, now int64, threshold int64, openSeconds int64, severe bool) (channelCircuitState, bool) {
	state.Failures++
	opened := severe || state.Failures >= threshold
	if opened {
		state.OpenUntil = now + openSeconds
		state.Probes = 0
	}
	return state, opened
}

func AllowChannelRequest(ctx context.Context, channelID int) (bool, int64, error) {
	config := common.GetTrafficControlConfig()
	if channelID <= 0 || config.CircuitFailureThreshold <= 0 {
		return true, 0, nil
	}
	if !common.RedisReady() {
		if !common.RedisEnabled {
			return true, 0, nil
		}
		return false, 0, common.ErrRedisUnavailable
	}
	opCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	result, err := channelCircuitAllowScript.Run(
		opCtx,
		common.RDB,
		[]string{channelCircuitKey(channelID)},
		config.CircuitFailureThreshold,
		config.CircuitHalfOpenProbes,
	).Slice()
	if err != nil {
		return false, 0, err
	}
	if len(result) != 2 {
		return false, 0, errors.New("invalid channel circuit response")
	}
	allowed, _ := result[0].(int64)
	retryAfter, _ := result[1].(int64)
	return allowed == 1, retryAfter, nil
}

func RecordChannelFailure(ctx context.Context, channelID int, severe bool) (bool, error) {
	config := common.GetTrafficControlConfig()
	if channelID <= 0 || config.CircuitFailureThreshold <= 0 {
		return false, nil
	}
	if !common.RedisReady() {
		if !common.RedisEnabled {
			return false, nil
		}
		return false, common.ErrRedisUnavailable
	}
	severeValue := 0
	if severe {
		severeValue = 1
	}
	opCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	result, err := channelCircuitFailureScript.Run(
		opCtx,
		common.RDB,
		[]string{channelCircuitKey(channelID)},
		config.CircuitFailureThreshold,
		config.CircuitOpenSeconds,
		severeValue,
	).Slice()
	if err != nil {
		return false, err
	}
	if len(result) != 2 {
		return false, errors.New("invalid channel circuit failure response")
	}
	opened, _ := result[1].(int64)
	return opened == 1, nil
}

func RecordChannelSuccess(ctx context.Context, channelID int) error {
	if channelID <= 0 || !common.RedisReady() {
		return nil
	}
	opCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return common.RDB.Del(opCtx, channelCircuitKey(channelID)).Err()
}
