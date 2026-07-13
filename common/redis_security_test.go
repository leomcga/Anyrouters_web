package common

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type redisSecurityFixture struct {
	Name    string
	Enabled bool
	Secret  *string
}

func captureRedisDebugLog(t *testing.T, action func()) string {
	t.Helper()
	oldDebug := DebugEnabled
	oldRedisEnabled := RedisEnabled
	oldRDB := RDB
	oldWriter := gin.DefaultWriter
	var output bytes.Buffer

	DebugEnabled = true
	RedisEnabled = true
	RDB = nil
	LogWriterMu.Lock()
	gin.DefaultWriter = &output
	LogWriterMu.Unlock()
	t.Cleanup(func() {
		DebugEnabled = oldDebug
		RedisEnabled = oldRedisEnabled
		RDB = oldRDB
		LogWriterMu.Lock()
		gin.DefaultWriter = oldWriter
		LogWriterMu.Unlock()
	})

	action()
	return output.String()
}

func TestRedisDebugLogsNeverContainKeysOrValues(t *testing.T) {
	secretKey := "token:sk-super-secret-key"
	shortSecretKey := "short-secret-key"
	secretValue := `{"webhook_secret":"whsec-sensitive","gotify_token":"gotify-sensitive"}`
	secretField := "Setting"

	logOutput := captureRedisDebugLog(t, func() {
		assert.ErrorIs(t, RedisSet(secretKey, secretValue, time.Minute), ErrRedisUnavailable)
		_, err := RedisGet(shortSecretKey)
		assert.ErrorIs(t, err, ErrRedisUnavailable)
		assert.ErrorIs(t, RedisHSetField(secretKey, secretField, secretValue), ErrRedisUnavailable)
		assert.ErrorIs(t, RedisDelKey(secretKey), ErrRedisUnavailable)
	})

	for _, sensitive := range []string{
		secretKey,
		shortSecretKey,
		"sk-super-secret-key",
		secretValue,
		"whsec-sensitive",
		"gotify-sensitive",
		secretField,
	} {
		assert.NotContains(t, logOutput, sensitive)
	}
	assert.Contains(t, logOutput, "key_hash=")
	assert.Contains(t, logOutput, "value_bytes=")
	assert.Contains(t, logOutput, "expiration=")
}

func TestRedisHSetObjDebugLogNeverContainsObjectData(t *testing.T) {
	secret := "nested-sensitive-token"
	fixture := &redisSecurityFixture{
		Name:    "private-user@example.com",
		Enabled: true,
		Secret:  &secret,
	}

	logOutput := captureRedisDebugLog(t, func() {
		assert.ErrorIs(t, RedisHSetObj("user:12345", fixture, time.Minute), ErrRedisUnavailable)
	})

	for _, sensitive := range []string{fixture.Name, secret, "12345"} {
		assert.NotContains(t, logOutput, sensitive)
	}
	assert.Contains(t, logOutput, "category=user")
	assert.Contains(t, logOutput, "field_count=3")
}

func TestRedisHSetObjRejectsInvalidInputsWithoutPanic(t *testing.T) {
	var nilFixture *redisSecurityFixture
	var nestedNil **redisSecurityFixture
	structValue := redisSecurityFixture{}
	nonStruct := "not-a-struct"

	tests := []struct {
		name  string
		value interface{}
	}{
		{name: "nil interface", value: nil},
		{name: "nil struct pointer", value: nilFixture},
		{name: "nested pointer", value: nestedNil},
		{name: "struct value", value: structValue},
		{name: "pointer to non-struct", value: &nonStruct},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			require.NotPanics(t, func() {
				err := RedisHSetObj("test:key", testCase.value, time.Minute)
				require.Error(t, err)
				assert.True(t,
					strings.Contains(err.Error(), "must") ||
						strings.Contains(err.Error(), "invalid"),
					err.Error(),
				)
			})
		})
	}
}

func TestRedisHashObjectFieldsPreservesSupportedValues(t *testing.T) {
	secret := "nested-value"
	fixture := &redisSecurityFixture{Name: "alice", Enabled: true, Secret: &secret}

	data, err := redisHashObjectFields(fixture)
	require.NoError(t, err)
	assert.Equal(t, "alice", data["Name"])
	assert.Equal(t, "true", data["Enabled"])
	assert.Equal(t, secret, data["Secret"])

	var nilSecret *string
	fixture.Secret = nilSecret
	data, err = redisHashObjectFields(fixture)
	require.NoError(t, err)
	assert.Equal(t, "", data["Secret"])
}
