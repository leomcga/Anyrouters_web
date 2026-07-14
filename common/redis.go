package common

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

var RDB *redis.Client
var RedisEnabled = true

var ErrRedisUnavailable = errors.New("redis is disabled or not initialized")

const redisOperationTimeout = 2 * time.Second

func redisIdentifierDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:6])
}

func redisCacheCategory(key string) string {
	category := strings.TrimSpace(key)
	if separator := strings.IndexByte(category, ':'); separator >= 0 {
		category = category[:separator]
	} else {
		return "other"
	}
	switch category {
	case "notify_limit", "rateLimit", "sub", "token", "user":
		return category
	default:
		return "other"
	}
}

func redisValueSize(value interface{}) int {
	switch typed := value.(type) {
	case string:
		return len(typed)
	case []byte:
		return len(typed)
	default:
		return len(fmt.Sprint(value))
	}
}

func redisHashObjectFields(obj interface{}) (map[string]interface{}, error) {
	if obj == nil {
		return nil, errors.New("redis hash object must not be nil")
	}
	value := reflect.ValueOf(obj)
	if !value.IsValid() {
		return nil, errors.New("redis hash object is invalid")
	}
	if value.Kind() != reflect.Ptr {
		return nil, fmt.Errorf("redis hash object must be a pointer to a struct, got %T", obj)
	}
	if value.IsNil() {
		return nil, fmt.Errorf("redis hash object pointer must not be nil, got %T", obj)
	}
	value = value.Elem()
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return nil, fmt.Errorf("redis hash object must point to a struct, got %T", obj)
	}

	valueType := value.Type()
	data := make(map[string]interface{}, value.NumField())
	for i := 0; i < value.NumField(); i++ {
		field := valueType.Field(i)
		fieldValue := value.Field(i)

		if field.Type.String() == "gorm.DeletedAt" {
			continue
		}
		if !fieldValue.CanInterface() {
			return nil, fmt.Errorf("redis hash object field %s is not exported", field.Name)
		}

		for fieldValue.Kind() == reflect.Ptr {
			if fieldValue.IsNil() {
				data[field.Name] = ""
				break
			}
			fieldValue = fieldValue.Elem()
		}
		if _, exists := data[field.Name]; exists {
			continue
		}
		if !fieldValue.IsValid() || !fieldValue.CanInterface() {
			return nil, fmt.Errorf("redis hash object field %s is invalid", field.Name)
		}
		if fieldValue.Kind() == reflect.Bool {
			data[field.Name] = strconv.FormatBool(fieldValue.Bool())
			continue
		}
		data[field.Name] = fmt.Sprintf("%v", fieldValue.Interface())
	}
	return data, nil
}

func RedisKeyCacheSeconds() int {
	return SyncFrequency
}

func RedisReady() bool {
	return RedisEnabled && RDB != nil
}

// InitRedisClient This function is called after init()
func InitRedisClient() (err error) {
	if os.Getenv("REDIS_CONN_STRING") == "" {
		RedisEnabled = false
		RDB = nil
		environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		if environment == "production" || environment == "prod" {
			return errors.New("production requires REDIS_CONN_STRING for shared rate limiting")
		}
		SysError("REDIS_CONN_STRING is not set; development is using local-only fallback limits")
		return nil
	}
	if os.Getenv("SYNC_FREQUENCY") == "" {
		SysLog("SYNC_FREQUENCY not set, use default value 60")
		SyncFrequency = 60
	}
	SysLog("Redis is enabled")
	opt, err := redis.ParseURL(os.Getenv("REDIS_CONN_STRING"))
	if err != nil {
		RedisEnabled = false
		RDB = nil
		return fmt.Errorf("failed to parse Redis connection string: %w", err)
	}
	opt.PoolSize = GetEnvOrDefault("REDIS_POOL_SIZE", 10)
	RDB = redis.NewClient(opt)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = RDB.Ping(ctx).Result()
	if err != nil {
		_ = RDB.Close()
		RDB = nil
		RedisEnabled = false
		return fmt.Errorf("Redis ping test failed: %w", err)
	}
	if DebugEnabled {
		SysLog(fmt.Sprintf("Redis connected to %s", opt.Addr))
		SysLog(fmt.Sprintf("Redis database: %d", opt.DB))
	}
	return err
}

var redisFixedWindowScript = redis.NewScript(`
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if limit <= 0 then
  return {1, current, ttl}
end
if current + amount > limit then
  local remaining = redis.call('TTL', KEYS[1])
  if remaining < 1 then remaining = ttl end
  return {0, current, remaining}
end
local next = redis.call('INCRBY', KEYS[1], amount)
if next == amount then redis.call('EXPIRE', KEYS[1], ttl) end
local remaining = redis.call('TTL', KEYS[1])
return {1, next, remaining}
`)

var redisReleaseCounterScript = redis.NewScript(`
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local next = current - amount
if next < 0 then next = 0 end
if next == 0 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], next, 'KEEPTTL')
end
return next
`)

var redisMultiLimitScript = redis.NewScript(`
local count = #KEYS
for i = 1, count do
  local base = (i - 1) * 3
  local amount = tonumber(ARGV[base + 1])
  local limit = tonumber(ARGV[base + 2])
  local ttl = tonumber(ARGV[base + 3])
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if limit > 0 and current + amount > limit then
    local remaining = redis.call('TTL', KEYS[i])
    if remaining < 1 then remaining = ttl end
    return {0, i, remaining}
  end
end
for i = 1, count do
  local base = (i - 1) * 3
  local amount = tonumber(ARGV[base + 1])
  local ttl = tonumber(ARGV[base + 3])
  local next = redis.call('INCRBY', KEYS[i], amount)
  if next == amount then redis.call('EXPIRE', KEYS[i], ttl) end
end
return {1, 0, 0}
`)

type RedisLimitEntry struct {
	Key    string
	Amount int64
	Limit  int64
	TTL    time.Duration
}

func RedisMultiLimitAcquire(ctx context.Context, entries []RedisLimitEntry) (bool, int, int64, error) {
	if len(entries) == 0 {
		return true, -1, 0, nil
	}
	if !RedisReady() {
		return false, -1, 0, ErrRedisUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	keys := make([]string, 0, len(entries))
	args := make([]interface{}, 0, len(entries)*3)
	for _, entry := range entries {
		if entry.Key == "" || entry.Amount < 0 || entry.Limit <= 0 || entry.TTL <= 0 {
			return false, -1, 0, errors.New("invalid Redis limit entry")
		}
		keys = append(keys, entry.Key)
		args = append(args, entry.Amount, entry.Limit, int64(entry.TTL.Seconds()))
	}
	opCtx, cancel := context.WithTimeout(ctx, redisOperationTimeout)
	defer cancel()
	result, err := redisMultiLimitScript.Run(opCtx, RDB, keys, args...).Slice()
	if err != nil {
		return false, -1, 0, fmt.Errorf("Redis multi-limit operation failed: %w", err)
	}
	if len(result) < 3 {
		return false, -1, 0, errors.New("Redis multi-limit returned an invalid result")
	}
	allowed, _ := result[0].(int64)
	failedIndex, _ := result[1].(int64)
	retryAfter, _ := result[2].(int64)
	if allowed == 1 {
		return true, -1, 0, nil
	}
	return false, int(failedIndex) - 1, retryAfter, nil
}

func RedisFixedWindowAllow(ctx context.Context, key string, amount int64, limit int64, ttl time.Duration) (bool, int64, error) {
	if !RedisReady() {
		return false, 0, ErrRedisUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := context.WithTimeout(ctx, redisOperationTimeout)
	defer cancel()
	result, err := redisFixedWindowScript.Run(
		opCtx,
		RDB,
		[]string{key},
		amount,
		limit,
		int64(ttl.Seconds()),
	).Slice()
	if err != nil {
		return false, 0, fmt.Errorf("Redis rate limit operation failed: %w", err)
	}
	if len(result) < 3 {
		return false, 0, errors.New("Redis rate limit returned an invalid result")
	}
	allowed, _ := result[0].(int64)
	retryAfter, _ := result[2].(int64)
	return allowed == 1, retryAfter, nil
}

func RedisReleaseCounter(ctx context.Context, key string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	if !RedisReady() {
		return ErrRedisUnavailable
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := context.WithTimeout(ctx, redisOperationTimeout)
	defer cancel()
	return redisReleaseCounterScript.Run(opCtx, RDB, []string{key}, amount).Err()
}

func ParseRedisOption() *redis.Options {
	opt, err := redis.ParseURL(os.Getenv("REDIS_CONN_STRING"))
	if err != nil {
		FatalLog("failed to parse Redis connection string: " + err.Error())
	}
	return opt
}

func redisOperationContext() (context.Context, context.CancelFunc, error) {
	if !RedisEnabled || RDB == nil {
		return nil, nil, ErrRedisUnavailable
	}
	ctx, cancel := context.WithTimeout(context.Background(), redisOperationTimeout)
	return ctx, cancel, nil
}

func RedisSet(key string, value string, expiration time.Duration) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis SET: category=%s key_hash=%s value_bytes=%d expiration=%v",
			redisCacheCategory(key), redisIdentifierDigest(key), len(value), expiration,
		))
	}
	ctx, cancel, err := redisOperationContext()
	if err != nil {
		return err
	}
	defer cancel()
	return RDB.Set(ctx, key, value, expiration).Err()
}

func RedisGet(key string) (string, error) {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis GET: category=%s key_hash=%s",
			redisCacheCategory(key), redisIdentifierDigest(key),
		))
	}
	ctx, cancel, err := redisOperationContext()
	if err != nil {
		return "", err
	}
	defer cancel()
	val, err := RDB.Get(ctx, key).Result()
	return val, err
}

//func RedisExpire(key string, expiration time.Duration) error {
//	ctx := context.Background()
//	return RDB.Expire(ctx, key, expiration).Err()
//}
//
//func RedisGetEx(key string, expiration time.Duration) (string, error) {
//	ctx := context.Background()
//	return RDB.GetSet(ctx, key, expiration).Result()
//}

func RedisDel(key string) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis DEL: category=%s key_hash=%s",
			redisCacheCategory(key), redisIdentifierDigest(key),
		))
	}
	ctx, cancel, err := redisOperationContext()
	if err != nil {
		return err
	}
	defer cancel()
	return RDB.Del(ctx, key).Err()
}

func RedisDelKey(key string) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis DEL Key: category=%s key_hash=%s",
			redisCacheCategory(key), redisIdentifierDigest(key),
		))
	}
	ctx, cancel, err := redisOperationContext()
	if err != nil {
		return err
	}
	defer cancel()
	return RDB.Del(ctx, key).Err()
}

func RedisHSetObj(key string, obj interface{}, expiration time.Duration) error {
	data, err := redisHashObjectFields(obj)
	if err != nil {
		return err
	}
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis HSET object: category=%s key_hash=%s field_count=%d expiration=%v",
			redisCacheCategory(key), redisIdentifierDigest(key), len(data), expiration,
		))
	}
	ctx, cancel, err := redisOperationContext()
	if err != nil {
		return err
	}
	defer cancel()

	txn := RDB.TxPipeline()
	txn.HSet(ctx, key, data)

	// 只有在 expiration 大于 0 时才设置过期时间
	if expiration > 0 {
		txn.Expire(ctx, key, expiration)
	}

	_, err = txn.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to execute transaction: %w", err)
	}
	return nil
}

func RedisHGetObj(key string, obj interface{}) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis HGETALL: category=%s key_hash=%s",
			redisCacheCategory(key), redisIdentifierDigest(key),
		))
	}
	ctx, cancel, err := redisOperationContext()
	if err != nil {
		return err
	}
	defer cancel()

	result, err := RDB.HGetAll(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("failed to load hash from Redis: %w", err)
	}

	if len(result) == 0 {
		return fmt.Errorf("key %s not found in Redis", key)
	}

	// Handle both pointer and non-pointer values
	val := reflect.ValueOf(obj)
	if val.Kind() != reflect.Ptr {
		return fmt.Errorf("obj must be a pointer to a struct, got %T", obj)
	}

	v := val.Elem()
	if v.Kind() != reflect.Struct {
		return fmt.Errorf("obj must be a pointer to a struct, got pointer to %T", v.Interface())
	}

	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		fieldName := field.Name
		if value, ok := result[fieldName]; ok {
			fieldValue := v.Field(i)

			// Handle pointer types
			if fieldValue.Kind() == reflect.Ptr {
				if value == "" {
					continue
				}
				if fieldValue.IsNil() {
					fieldValue.Set(reflect.New(fieldValue.Type().Elem()))
				}
				fieldValue = fieldValue.Elem()
			}

			// Enhanced type handling for Token struct
			switch fieldValue.Kind() {
			case reflect.String:
				fieldValue.SetString(value)
			case reflect.Int, reflect.Int64:
				intValue, err := strconv.ParseInt(value, 10, 64)
				if err != nil {
					return fmt.Errorf("failed to parse int field %s: %w", fieldName, err)
				}
				fieldValue.SetInt(intValue)
			case reflect.Bool:
				boolValue, err := strconv.ParseBool(value)
				if err != nil {
					return fmt.Errorf("failed to parse bool field %s: %w", fieldName, err)
				}
				fieldValue.SetBool(boolValue)
			case reflect.Struct:
				// Special handling for gorm.DeletedAt
				if fieldValue.Type().String() == "gorm.DeletedAt" {
					if value != "" {
						timeValue, err := time.Parse(time.RFC3339, value)
						if err != nil {
							return fmt.Errorf("failed to parse DeletedAt field %s: %w", fieldName, err)
						}
						fieldValue.Set(reflect.ValueOf(gorm.DeletedAt{Time: timeValue, Valid: true}))
					}
				}
			default:
				return fmt.Errorf("unsupported field type: %s for field %s", fieldValue.Kind(), fieldName)
			}
		}
	}

	return nil
}

// RedisIncr Add this function to handle atomic increments
func RedisIncr(key string, delta int64) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis INCR: category=%s key_hash=%s delta=%d",
			redisCacheCategory(key), redisIdentifierDigest(key), delta,
		))
	}
	ctx, cancel, ctxErr := redisOperationContext()
	if ctxErr != nil {
		return ctxErr
	}
	defer cancel()
	// 检查键的剩余生存时间
	ttlCmd := RDB.TTL(ctx, key)
	ttl, err := ttlCmd.Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("failed to get TTL: %w", err)
	}

	// 只有在 key 存在且有 TTL 时才需要特殊处理
	if ttl > 0 {
		// 开始一个Redis事务
		txn := RDB.TxPipeline()

		// 减少余额
		decrCmd := txn.IncrBy(ctx, key, delta)
		if err := decrCmd.Err(); err != nil {
			return err // 如果减少失败，则直接返回错误
		}

		// 重新设置过期时间，使用原来的过期时间
		txn.Expire(ctx, key, ttl)

		// 执行事务
		_, err = txn.Exec(ctx)
		return err
	}
	return nil
}

func RedisHIncrBy(key, field string, delta int64) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis HINCRBY: category=%s key_hash=%s field_hash=%s delta=%d",
			redisCacheCategory(key), redisIdentifierDigest(key), redisIdentifierDigest(field), delta,
		))
	}
	ctx, cancel, ctxErr := redisOperationContext()
	if ctxErr != nil {
		return ctxErr
	}
	defer cancel()
	ttlCmd := RDB.TTL(ctx, key)
	ttl, err := ttlCmd.Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("failed to get TTL: %w", err)
	}

	if ttl > 0 {
		txn := RDB.TxPipeline()

		incrCmd := txn.HIncrBy(ctx, key, field, delta)
		if err := incrCmd.Err(); err != nil {
			return err
		}

		txn.Expire(ctx, key, ttl)

		_, err = txn.Exec(ctx)
		return err
	}
	return nil
}

func RedisHSetField(key, field string, value interface{}) error {
	if DebugEnabled {
		SysLog(fmt.Sprintf(
			"Redis HSET field: category=%s key_hash=%s field_hash=%s value_bytes=%d",
			redisCacheCategory(key), redisIdentifierDigest(key), redisIdentifierDigest(field), redisValueSize(value),
		))
	}
	ctx, cancel, ctxErr := redisOperationContext()
	if ctxErr != nil {
		return ctxErr
	}
	defer cancel()
	ttlCmd := RDB.TTL(ctx, key)
	ttl, err := ttlCmd.Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("failed to get TTL: %w", err)
	}

	if ttl > 0 {
		txn := RDB.TxPipeline()

		hsetCmd := txn.HSet(ctx, key, field, value)
		if err := hsetCmd.Err(); err != nil {
			return err
		}

		txn.Expire(ctx, key, ttl)

		_, err = txn.Exec(ctx)
		return err
	}
	return nil
}
