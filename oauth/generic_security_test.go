package oauth

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func captureOAuthLogs(t *testing.T, action func()) string {
	t.Helper()
	oldDebug := common.DebugEnabled
	oldWriter := gin.DefaultErrorWriter
	var output bytes.Buffer

	common.DebugEnabled = true
	common.LogWriterMu.Lock()
	gin.DefaultErrorWriter = &output
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.DebugEnabled = oldDebug
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	action()
	return output.String()
}

func newGenericOAuthTestProvider(tokenEndpoint string) *GenericOAuthProvider {
	return NewGenericOAuthProvider(&model.CustomOAuthProvider{
		Name:          "Security Provider",
		Slug:          "security-provider",
		ClientId:      "client-id-sensitive",
		ClientSecret:  "client-secret-sensitive",
		TokenEndpoint: tokenEndpoint,
		AuthStyle:     AuthStyleInParams,
	})
}

func allowOAuthLoopbackForTest(t *testing.T, endpoint string) {
	t.Helper()
	fetchSetting := system_setting.GetFetchSetting()
	oldAllowPrivate := fetchSetting.AllowPrivateIp
	oldAllowedPorts := append([]string(nil), fetchSetting.AllowedPorts...)
	oldAllowHTTP := common.OutboundAllowHTTP
	fetchSetting.AllowPrivateIp = true
	parsed, err := url.Parse(endpoint)
	require.NoError(t, err)
	fetchSetting.AllowedPorts = append(fetchSetting.AllowedPorts, parsed.Port())
	common.OutboundAllowHTTP = true
	t.Cleanup(func() {
		fetchSetting.AllowPrivateIp = oldAllowPrivate
		fetchSetting.AllowedPorts = oldAllowedPorts
		common.OutboundAllowHTTP = oldAllowHTTP
	})
}

func TestGenericOAuthTokenResponseSecretsNeverReachLogs(t *testing.T) {
	const (
		authorizationCode = "authorization-code-sensitive"
		accessToken       = "access-token-sensitive"
		refreshToken      = "refresh-token-sensitive"
		idToken           = "id-token-sensitive"
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		assert.Equal(t, authorizationCode, r.Form.Get("code"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(
			w,
			`{"access_token":%q,"refresh_token":%q,"id_token":%q,"expires_in":3600,"token_type":"Bearer"}`,
			accessToken,
			refreshToken,
			idToken,
		)
	}))
	defer server.Close()
	allowOAuthLoopbackForTest(t, server.URL)

	provider := newGenericOAuthTestProvider(server.URL)
	var token *OAuthToken
	logOutput := captureOAuthLogs(t, func() {
		var err error
		token, err = provider.ExchangeToken(context.Background(), authorizationCode, nil)
		require.NoError(t, err)
	})

	require.NotNil(t, token)
	assert.Equal(t, accessToken, token.AccessToken)
	assert.Equal(t, refreshToken, token.RefreshToken)
	assert.Equal(t, idToken, token.IDToken)
	for _, sensitive := range []string{
		authorizationCode,
		accessToken,
		refreshToken,
		idToken,
		"client-secret-sensitive",
		"client-id-sensitive",
		server.URL,
	} {
		assert.NotContains(t, logOutput, sensitive)
	}
	assert.Contains(t, logOutput, "status=200")
	assert.Contains(t, logOutput, "access_token_present=true")
	assert.Contains(t, logOutput, "refresh_token_present=true")
	assert.Contains(t, logOutput, "id_token_present=true")
	assert.Contains(t, logOutput, "expires_in=3600")
}

func TestGenericOAuthErrorBodySecretsNeverReachLogsOrReturnedError(t *testing.T) {
	const leakedValue = "token-value-hidden-in-provider-error"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = fmt.Fprintf(
			w,
			`{"error":"invalid_grant","error_description":"access_token=%s refresh_token=%s id_token=%s"}`,
			leakedValue,
			leakedValue,
			leakedValue,
		)
	}))
	defer server.Close()
	allowOAuthLoopbackForTest(t, server.URL)

	provider := newGenericOAuthTestProvider(server.URL)
	var exchangeErr error
	logOutput := captureOAuthLogs(t, func() {
		_, exchangeErr = provider.ExchangeToken(context.Background(), "authorization-code-sensitive", nil)
	})

	require.Error(t, exchangeErr)
	assert.NotContains(t, exchangeErr.Error(), leakedValue)
	assert.NotContains(t, logOutput, leakedValue)
	for _, forbidden := range []string{"access_token=", "refresh_token=", "id_token=", "authorization-code-sensitive"} {
		assert.False(t, strings.Contains(logOutput, forbidden), logOutput)
	}
}
