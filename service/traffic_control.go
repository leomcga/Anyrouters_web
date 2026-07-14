package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

type trafficLimitEntry struct {
	Name       string
	Key        string
	Amount     int64
	Limit      int64
	TTL        time.Duration
	Releasable bool
}

type trafficBackend interface {
	Acquire(context.Context, []trafficLimitEntry) (bool, int, int64, error)
	Release(context.Context, trafficLimitEntry, int64) error
}

type redisTrafficBackend struct{}

func (redisTrafficBackend) Acquire(ctx context.Context, entries []trafficLimitEntry) (bool, int, int64, error) {
	redisEntries := make([]common.RedisLimitEntry, 0, len(entries))
	for _, entry := range entries {
		redisEntries = append(redisEntries, common.RedisLimitEntry{
			Key: entry.Key, Amount: entry.Amount, Limit: entry.Limit, TTL: entry.TTL,
		})
	}
	return common.RedisMultiLimitAcquire(ctx, redisEntries)
}

func (redisTrafficBackend) Release(ctx context.Context, entry trafficLimitEntry, amount int64) error {
	return common.RedisReleaseCounter(ctx, entry.Key, amount)
}

type TrafficLimitError struct {
	Dimension  string
	RetryAfter int64
}

func (e *TrafficLimitError) Error() string {
	return fmt.Sprintf("traffic limit exceeded: %s", e.Dimension)
}

type TrafficLease struct {
	backend    trafficBackend
	entries    []trafficLimitEntry
	committed  bool
	closed     bool
	mu         sync.Mutex
	tokenEntry int
	quotaEntry int
}

func trafficDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:8])
}

func secondsUntilUTCMidnight(now time.Time) time.Duration {
	next := now.UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	duration := next.Sub(now.UTC())
	if duration < time.Minute {
		return time.Minute
	}
	return duration
}

func appendTrafficEntry(entries []trafficLimitEntry, name string, identity string, amount int64, limit int64, ttl time.Duration, releasable bool) []trafficLimitEntry {
	if identity == "" || amount <= 0 || limit <= 0 {
		return entries
	}
	return append(entries, trafficLimitEntry{
		Name:       name,
		Key:        "traffic:" + name + ":" + trafficDigest(identity),
		Amount:     amount,
		Limit:      limit,
		TTL:        ttl,
		Releasable: releasable,
	})
}

func AcquireTrafficLimits(c *gin.Context, info *relaycommon.RelayInfo, estimatedTokens int64, estimatedQuota int64) (*TrafficLease, error) {
	return acquireTrafficLimitsWithBackend(c, info, estimatedTokens, estimatedQuota, redisTrafficBackend{}, true)
}

func acquireTrafficLimitsWithBackend(c *gin.Context, info *relaycommon.RelayInfo, estimatedTokens int64, estimatedQuota int64, backend trafficBackend, requireRedis bool) (*TrafficLease, error) {
	config := common.GetTrafficControlConfig()
	if !config.Enabled || info == nil {
		return nil, nil
	}
	if c == nil || c.Request == nil {
		return nil, errors.New("traffic control requires a request context")
	}
	if estimatedTokens < 1 {
		estimatedTokens = 1
	}
	if estimatedQuota < 0 {
		estimatedQuota = 0
	}
	if requireRedis && !common.RedisReady() {
		return nil, common.ErrRedisUnavailable
	}

	userIdentity := fmt.Sprintf("%d", info.UserId)
	keyIdentity := info.TokenKey
	ipIdentity := ""
	if c != nil {
		ipIdentity = c.ClientIP()
	}
	modelIdentity := info.OriginModelName
	if c != nil && common.GetContextKeyString(c, constant.ContextKeyFinalModel) != "" {
		modelIdentity = common.GetContextKeyString(c, constant.ContextKeyFinalModel)
	}
	channelIdentity := fmt.Sprintf("%d", info.ChannelId)

	entries := make([]trafficLimitEntry, 0, 22)
	for _, dimension := range []struct {
		name     string
		identity string
		rpm      int64
		tpm      int64
		concur   int64
	}{
		{"user", userIdentity, config.UserRPM, config.UserTPM, config.UserConcurrent},
		{"key", keyIdentity, config.KeyRPM, config.KeyTPM, config.KeyConcurrent},
		{"ip", ipIdentity, config.IPRPM, config.IPTPM, config.IPConcurrent},
		{"model", modelIdentity, config.ModelRPM, config.ModelTPM, config.ModelConcurrent},
		{"channel", channelIdentity, config.ChannelRPM, config.ChannelTPM, config.ChannelConcurrent},
	} {
		entries = appendTrafficEntry(entries, "rpm:"+dimension.name, dimension.identity, 1, dimension.rpm, time.Minute, false)
		entries = appendTrafficEntry(entries, "tpm:"+dimension.name, dimension.identity, estimatedTokens, dimension.tpm, time.Minute, false)
		entries = appendTrafficEntry(entries, "concurrent:"+dimension.name, dimension.identity, 1, dimension.concur, 15*time.Minute, true)
	}

	dailyTTL := secondsUntilUTCMidnight(time.Now())
	tokenEntry := len(entries)
	entries = appendTrafficEntry(entries, "daily_tokens:user", userIdentity, estimatedTokens, config.UserDailyTokens, dailyTTL, true)
	entries = appendTrafficEntry(entries, "daily_tokens:key", keyIdentity, estimatedTokens, config.KeyDailyTokens, dailyTTL, true)
	quotaEntry := len(entries)
	if estimatedQuota > 0 {
		entries = appendTrafficEntry(entries, "daily_quota:user", userIdentity, estimatedQuota, config.UserDailyQuota, dailyTTL, true)
	} else {
		quotaEntry = -1
	}

	allowed, failedIndex, retryAfter, err := backend.Acquire(c.Request.Context(), entries)
	if err != nil {
		return nil, err
	}
	if !allowed {
		dimension := "unknown"
		if failedIndex >= 0 && failedIndex < len(entries) {
			dimension = entries[failedIndex].Name
		}
		return nil, &TrafficLimitError{Dimension: dimension, RetryAfter: retryAfter}
	}
	return &TrafficLease{
		backend: backend, entries: entries, tokenEntry: tokenEntry, quotaEntry: quotaEntry,
	}, nil
}

func (lease *TrafficLease) Commit(actualTokens int64, actualQuota int64) {
	if lease == nil {
		return
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if lease.closed || lease.committed {
		return
	}
	lease.committed = true
	lease.adjustReservation(lease.tokenEntry, actualTokens)
	if lease.tokenEntry+1 < len(lease.entries) && lease.entries[lease.tokenEntry+1].Name == "daily_tokens:key" {
		lease.adjustReservation(lease.tokenEntry+1, actualTokens)
	}
	if lease.quotaEntry >= 0 {
		lease.adjustReservation(lease.quotaEntry, actualQuota)
	}
}

func (lease *TrafficLease) adjustReservation(index int, actual int64) {
	if index < 0 || index >= len(lease.entries) || actual < 0 {
		return
	}
	entry := lease.entries[index]
	if actual > entry.Amount {
		deltaEntry := entry
		deltaEntry.Amount = actual - entry.Amount
		allowed, _, _, err := lease.backend.Acquire(context.Background(), []trafficLimitEntry{deltaEntry})
		if err != nil || !allowed {
			common.SysError(fmt.Sprintf("traffic actual usage exceeded reservation: dimension=%s", entry.Name))
			return
		}
		lease.entries[index].Amount = actual
		return
	}
	if actual == entry.Amount {
		return
	}
	_ = lease.backend.Release(context.Background(), entry, entry.Amount-actual)
	lease.entries[index].Amount = actual
}

func (lease *TrafficLease) Close(success bool) {
	if lease == nil {
		return
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if lease.closed {
		return
	}
	lease.closed = true
	for _, entry := range lease.entries {
		if !entry.Releasable {
			continue
		}
		if success && !strings.HasPrefix(entry.Name, "concurrent:") {
			continue
		}
		if err := lease.backend.Release(context.Background(), entry, entry.Amount); err != nil && !errors.Is(err, common.ErrRedisUnavailable) {
			common.SysError(fmt.Sprintf("traffic counter release failed: dimension=%s", entry.Name))
		}
	}
}

type memoryTrafficValue struct {
	value     int64
	expiresAt time.Time
}

type memoryTrafficBackend struct {
	mu     sync.Mutex
	values map[string]memoryTrafficValue
}

func newMemoryTrafficBackend() *memoryTrafficBackend {
	return &memoryTrafficBackend{values: map[string]memoryTrafficValue{}}
}

func (backend *memoryTrafficBackend) Acquire(_ context.Context, entries []trafficLimitEntry) (bool, int, int64, error) {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	now := time.Now()
	for index, entry := range entries {
		current := backend.values[entry.Key]
		if !current.expiresAt.IsZero() && !current.expiresAt.After(now) {
			current = memoryTrafficValue{}
		}
		if current.value+entry.Amount > entry.Limit {
			retry := int64(time.Until(current.expiresAt).Seconds())
			if retry < 1 {
				retry = 1
			}
			return false, index, retry, nil
		}
	}
	for _, entry := range entries {
		current := backend.values[entry.Key]
		if !current.expiresAt.IsZero() && !current.expiresAt.After(now) {
			current = memoryTrafficValue{}
		}
		current.value += entry.Amount
		if current.expiresAt.IsZero() {
			current.expiresAt = now.Add(entry.TTL)
		}
		backend.values[entry.Key] = current
	}
	return true, -1, 0, nil
}

func (backend *memoryTrafficBackend) Release(_ context.Context, entry trafficLimitEntry, amount int64) error {
	backend.mu.Lock()
	defer backend.mu.Unlock()
	current := backend.values[entry.Key]
	current.value -= amount
	if current.value < 0 {
		current.value = 0
	}
	backend.values[entry.Key] = current
	return nil
}
