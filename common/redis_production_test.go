package common

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestProductionRequiresRedis(t *testing.T) {
	oldEnabled := RedisEnabled
	oldRDB := RDB
	t.Cleanup(func() {
		RedisEnabled = oldEnabled
		RDB = oldRDB
	})
	t.Setenv("APP_ENV", "production")
	t.Setenv("REDIS_CONN_STRING", "")
	require.Error(t, InitRedisClient())
	require.False(t, RedisEnabled)
	require.Nil(t, RDB)
}

func TestDevelopmentAllowsExplicitRedisFallback(t *testing.T) {
	oldEnabled := RedisEnabled
	oldRDB := RDB
	t.Cleanup(func() {
		RedisEnabled = oldEnabled
		RDB = oldRDB
	})
	t.Setenv("APP_ENV", "development")
	t.Setenv("REDIS_CONN_STRING", "")
	require.NoError(t, InitRedisClient())
	require.False(t, RedisEnabled)
	require.Nil(t, RDB)
}

func TestRedisLimitOperationsFailSafelyWhenUninitialized(t *testing.T) {
	oldEnabled := RedisEnabled
	oldRDB := RDB
	RedisEnabled = true
	RDB = nil
	t.Cleanup(func() {
		RedisEnabled = oldEnabled
		RDB = oldRDB
	})

	require.NotPanics(t, func() {
		allowed, _, _, err := RedisMultiLimitAcquire(context.Background(), []RedisLimitEntry{{
			Key: "traffic:test", Amount: 1, Limit: 1, TTL: time.Minute,
		}})
		require.False(t, allowed)
		require.ErrorIs(t, err, ErrRedisUnavailable)
	})
}
