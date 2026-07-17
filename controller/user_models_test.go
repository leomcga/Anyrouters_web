package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGetUserModelsIncludesUnavailableCatalogModelWithoutRoutingAbility(t *testing.T) {
	t.Setenv("TEMPORARILY_UNAVAILABLE_MODELS", "claude-opus-4-8")
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.User{
		Id:       1002,
		Username: "catalog-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "claude-opus-4-8",
		Status:    1,
		NameRule:  model.NameRuleExact,
	}).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     "default",
		Model:     "claude-opus-4-6",
		ChannelId: 5,
		Enabled:   true,
	}).Error)
	model.InvalidatePricingCache()
	t.Cleanup(model.InvalidatePricingCache)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/models", nil)
	ctx.Set("id", 1002)

	GetUserModels(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload struct {
		Success           bool     `json:"success"`
		Data              []string `json:"data"`
		UnavailableModels []string `json:"unavailable_models"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	require.Contains(t, payload.Data, "claude-opus-4-6")
	require.Contains(t, payload.Data, "claude-opus-4-8")
	require.Contains(t, payload.UnavailableModels, "claude-opus-4-8")
	require.NotContains(t, model.GetGroupEnabledModels("default"), "claude-opus-4-8")

	pricingByName := pricingByModelName(model.GetPricing())
	require.True(t, pricingByName["claude-opus-4-8"].Unavailable)
	require.Equal(t, []string{"all"}, pricingByName["claude-opus-4-8"].EnableGroup)
}
