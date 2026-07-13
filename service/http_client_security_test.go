package service

import (
	"os"
	"os/exec"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/require"
)

func TestProductionOutboundSecurityFailsClosed(t *testing.T) {
	fetchSetting := system_setting.GetFetchSetting()
	oldFetch := *fetchSetting
	oldValues := struct {
		allowHTTP        bool
		maxRedirects     int
		maxRequestBytes  int64
		maxResponseBytes int64
		connectTimeout   int
		tlsTimeout       int
		headerTimeout    int
		requestTimeout   int
		insecureSkipTLS  bool
	}{
		common.OutboundAllowHTTP,
		common.OutboundMaxRedirects,
		common.OutboundMaxRequestBodyBytes,
		common.OutboundMaxResponseBodyBytes,
		common.OutboundConnectTimeoutSeconds,
		common.OutboundTLSHandshakeTimeoutSeconds,
		common.OutboundResponseHeaderTimeoutSeconds,
		common.OutboundRequestTimeoutSeconds,
		common.TLSInsecureSkipVerify,
	}
	t.Cleanup(func() {
		*fetchSetting = oldFetch
		common.OutboundAllowHTTP = oldValues.allowHTTP
		common.OutboundMaxRedirects = oldValues.maxRedirects
		common.OutboundMaxRequestBodyBytes = oldValues.maxRequestBytes
		common.OutboundMaxResponseBodyBytes = oldValues.maxResponseBytes
		common.OutboundConnectTimeoutSeconds = oldValues.connectTimeout
		common.OutboundTLSHandshakeTimeoutSeconds = oldValues.tlsTimeout
		common.OutboundResponseHeaderTimeoutSeconds = oldValues.headerTimeout
		common.OutboundRequestTimeoutSeconds = oldValues.requestTimeout
		common.TLSInsecureSkipVerify = oldValues.insecureSkipTLS
	})

	t.Setenv("APP_ENV", "production")
	fetchSetting.EnableSSRFProtection = true
	fetchSetting.AllowPrivateIp = false
	fetchSetting.ApplyIPFilterForDomain = true
	common.OutboundMaxRedirects = 3
	common.OutboundMaxRequestBodyBytes = 1024
	common.OutboundMaxResponseBodyBytes = 1024
	common.OutboundConnectTimeoutSeconds = 1
	common.OutboundTLSHandshakeTimeoutSeconds = 1
	common.OutboundResponseHeaderTimeoutSeconds = 1
	common.OutboundRequestTimeoutSeconds = 1
	common.TLSInsecureSkipVerify = false
	common.OutboundAllowHTTP = false
	require.NoError(t, ValidateOutboundSecurityConfig())

	fetchSetting.EnableSSRFProtection = false
	require.Error(t, ValidateOutboundSecurityConfig())
	fetchSetting.EnableSSRFProtection = true
	fetchSetting.AllowPrivateIp = true
	require.Error(t, ValidateOutboundSecurityConfig())
	fetchSetting.AllowPrivateIp = false
	fetchSetting.ApplyIPFilterForDomain = false
	require.Error(t, ValidateOutboundSecurityConfig())
	fetchSetting.ApplyIPFilterForDomain = true
	common.TLSInsecureSkipVerify = true
	require.Error(t, ValidateOutboundSecurityConfig())
	common.TLSInsecureSkipVerify = false
	common.OutboundAllowHTTP = true
	require.Error(t, ValidateOutboundSecurityConfig())
}

func TestProductionExplicitProxyMustBeTrustedAndCredentialFree(t *testing.T) {
	oldTrusted := append([]string(nil), common.OutboundTrustedProxyURLs...)
	oldAllowHTTP := common.OutboundAllowHTTP
	t.Cleanup(func() {
		common.OutboundTrustedProxyURLs = oldTrusted
		common.OutboundAllowHTTP = oldAllowHTTP
	})
	t.Setenv("APP_ENV", "production")
	common.OutboundAllowHTTP = false

	require.Error(t, ValidateExplicitProxy("https://user:pass@93.184.216.34:443"))
	require.Error(t, ValidateExplicitProxy("https://127.0.0.1:443"))
	require.Error(t, ValidateExplicitProxy("https://93.184.216.34:443"))

	common.OutboundTrustedProxyURLs = []string{"https://93.184.216.34:443"}
	require.NoError(t, ValidateExplicitProxy("https://93.184.216.34:443"))
}

func TestProductionDisablesRemoteWorkerURLForwarding(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	require.False(t, remoteWorkerOutboundAllowed())
	t.Setenv("APP_ENV", "development")
	require.True(t, remoteWorkerOutboundAllowed())
}

func TestOutboundReadinessScriptFailsClosed(t *testing.T) {
	script := "../ops/verify-outbound-security-readiness.sh"
	missingEnv := exec.Command("bash", script)
	missingEnv.Env = []string{"PATH=" + os.Getenv("PATH")}
	require.Error(t, missingEnv.Run())

	validEnv := exec.Command("bash", script)
	validEnv.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"APP_ENV=production",
		"OUTBOUND_ALLOW_HTTP=false",
		"TLS_INSECURE_SKIP_VERIFY=false",
		"OUTBOUND_MAX_REDIRECTS=3",
		"OUTBOUND_MAX_REQUEST_BYTES=67108864",
		"OUTBOUND_MAX_RESPONSE_BYTES=134217728",
		"OUTBOUND_CONNECT_TIMEOUT_SECONDS=10",
		"OUTBOUND_TLS_HANDSHAKE_TIMEOUT_SECONDS=10",
		"OUTBOUND_RESPONSE_HEADER_TIMEOUT_SECONDS=30",
		"OUTBOUND_REQUEST_TIMEOUT_SECONDS=600",
	}
	output, err := validEnv.CombinedOutput()
	require.NoError(t, err, string(output))
	require.Contains(t, string(output), "Outbound security readiness passed")
}
