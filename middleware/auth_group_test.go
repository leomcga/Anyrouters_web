package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestResolveTokenGroupForUser(t *testing.T) {
	tests := []struct {
		name       string
		userGroup  string
		tokenGroup string
		want       string
	}{
		{name: "ordinary token keeps default", userGroup: "default", tokenGroup: "default", want: "default"},
		{name: "ordinary token keeps explicit group", userGroup: "default", tokenGroup: "vip", want: "vip"},
		{name: "ordinary token keeps auto group", userGroup: "default", tokenGroup: "auto", want: "auto"},
		{name: "shared B2B overrides stale default token", userGroup: "btob", tokenGroup: "default", want: "btob"},
		{name: "dedicated B2B overrides stale default token", userGroup: "b2b_16", tokenGroup: "default", want: "b2b_16"},
		{name: "dedicated B2B overrides empty token group", userGroup: "b2b_16", tokenGroup: "", want: "b2b_16"},
		{name: "dedicated B2B overrides auto token group", userGroup: "b2b_16", tokenGroup: "auto", want: "b2b_16"},
		{name: "dedicated B2B follows a customer move", userGroup: "b2b_42", tokenGroup: "b2b_16", want: "b2b_42"},
		{name: "customer moved out of B2B drops stale dedicated token group", userGroup: "default", tokenGroup: "b2b_16", want: "default"},
		{name: "customer moved out of B2B drops stale shared token group", userGroup: "vip", tokenGroup: "btob", want: "vip"},
		{name: "legacy empty user group drops stale B2B token to default", userGroup: "", tokenGroup: "b2b_16", want: "default"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, resolveTokenGroupForUser(tt.userGroup, tt.tokenGroup))
		})
	}
}

func TestTokenAuthAlignsTokenAndUsingGroupForB2BCustomer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	common.RedisEnabled = false
	common.UsingSQLite = true

	oldDB := model.DB
	oldLogDB := model.LOG_DB
	oldSQLitePath := common.SQLitePath
	oldIsMasterNode := common.IsMasterNode
	oldPepper := common.APIKeyPepper
	oldLegacyAuth := common.APIKeyLegacyAuthEnabled
	common.APIKeyPepper = "middleware-auth-test-pepper-with-sufficient-entropy"
	common.APIKeyLegacyAuthEnabled = true
	oldGroupRatio := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		model.DB = oldDB
		model.LOG_DB = oldLogDB
		common.SQLitePath = oldSQLitePath
		common.IsMasterNode = oldIsMasterNode
		common.APIKeyPepper = oldPepper
		common.APIKeyLegacyAuthEnabled = oldLegacyAuth
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldGroupRatio))
	})

	t.Setenv("SQL_DSN", "")
	common.SQLitePath = "file:auth_group_test?mode=memory&cache=shared"
	common.IsMasterNode = false
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	sqlDB, err := model.DB.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(
		`{"default":1,"btob":1,"b2b_16":1}`,
	))

	require.NoError(t, model.DB.Create(&model.User{
		Id:       16,
		Username: "b2b-user",
		Group:    "b2b_16",
		Quota:    1_000_000,
		Status:   common.UserStatusEnabled,
		Role:     common.RoleCommonUser,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		Id:             16,
		UserId:         16,
		Key:            "legacytokenkey",
		Name:           "legacy-default-token",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		RemainQuota:    1_000_000,
		UnlimitedQuota: false,
		Group:          "default",
	}).Error)

	var tokenGroup string
	var usingGroup string
	router := gin.New()
	router.Use(TokenAuth())
	router.POST("/v1/chat/completions", func(c *gin.Context) {
		tokenGroup = common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		usingGroup = common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer sk-legacytokenkey")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	require.Equal(t, http.StatusNoContent, recorder.Code)
	require.Equal(t, "b2b_16", tokenGroup)
	require.Equal(t, "b2b_16", usingGroup)
}
