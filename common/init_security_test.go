package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
)

func TestResolveDebugMode(t *testing.T) {
	tests := []struct {
		name        string
		appEnv      string
		debugValue  string
		wantEnabled bool
		wantBlocked bool
	}{
		{
			name:        "development debug enabled",
			appEnv:      "development",
			debugValue:  "true",
			wantEnabled: true,
		},
		{
			name:        "staging debug enabled",
			appEnv:      "staging",
			debugValue:  "TRUE",
			wantEnabled: true,
		},
		{
			name:        "production debug forced off",
			appEnv:      "production",
			debugValue:  "true",
			wantBlocked: true,
		},
		{
			name:        "prod alias debug forced off",
			appEnv:      "prod",
			debugValue:  "true",
			wantBlocked: true,
		},
		{
			name:       "production debug disabled",
			appEnv:     "production",
			debugValue: "false",
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			enabled, blocked := resolveDebugMode(testCase.appEnv, testCase.debugValue)
			assert.Equal(t, testCase.wantEnabled, enabled)
			assert.Equal(t, testCase.wantBlocked, blocked)
		})
	}
}

func TestProductionRequiresAPIKeyPepper(t *testing.T) {
	oldPepper := APIKeyPepper
	t.Cleanup(func() {
		APIKeyPepper = oldPepper
	})

	t.Setenv("APP_ENV", "production")
	APIKeyPepper = ""
	assert.Error(t, ValidateAPIKeySecurityConfig())

	APIKeyPepper = "production-api-key-pepper-from-secret-manager"
	assert.NoError(t, ValidateAPIKeySecurityConfig())
}

func TestProductionTrafficControlFailsClosedOnUnlimitedConfiguration(t *testing.T) {
	oldEnabled := TrafficControlEnabled
	oldRPM := TrafficUserRPMLimit
	t.Cleanup(func() {
		TrafficControlEnabled = oldEnabled
		TrafficUserRPMLimit = oldRPM
	})
	t.Setenv("APP_ENV", "production")
	TrafficControlEnabled = true
	TrafficUserRPMLimit = 0
	assert.Error(t, ValidateTrafficControlConfig())
}

func TestProductionWebSecurityRejectsDebugSubsystems(t *testing.T) {
	oldDifyDebug := constant.DifyDebug
	t.Cleanup(func() {
		constant.DifyDebug = oldDifyDebug
	})
	t.Setenv("APP_ENV", "production")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://anyrouters.com")
	t.Setenv("ENABLE_PPROF", "false")

	constant.DifyDebug = true
	assert.Error(t, ValidateWebSecurityConfig())

	constant.DifyDebug = false
	t.Setenv("ENABLE_PPROF", "true")
	assert.Error(t, ValidateWebSecurityConfig())

	t.Setenv("ENABLE_PPROF", "false")
	assert.NoError(t, ValidateWebSecurityConfig())
}
