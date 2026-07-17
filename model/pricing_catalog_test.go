package model

import (
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestAddTemporarilyUnavailableCatalogModels(t *testing.T) {
	t.Setenv("TEMPORARILY_UNAVAILABLE_MODELS", "claude-opus-4-8,disabled-model,prefix-*")

	existingGroups := types.NewSet[string]()
	existingGroups.Add("default")
	groupsByModel := map[string]*types.Set[string]{
		"claude-opus-4-8": existingGroups,
	}

	addTemporarilyUnavailableCatalogModels(groupsByModel, []Model{
		{ModelName: "claude-opus-4-8", Status: 1, NameRule: NameRuleExact},
		{ModelName: "disabled-model", Status: 0, NameRule: NameRuleExact},
		{ModelName: "prefix-*", Status: 1, NameRule: NameRulePrefix},
	})

	require.Equal(t, []string{"default"}, groupsByModel["claude-opus-4-8"].Items())
	require.NotContains(t, groupsByModel, "disabled-model")
	require.NotContains(t, groupsByModel, "prefix-*")

	delete(groupsByModel, "claude-opus-4-8")
	addTemporarilyUnavailableCatalogModels(groupsByModel, []Model{
		{ModelName: "claude-opus-4-8", Status: 1, NameRule: NameRuleExact},
	})
	require.True(t, groupsByModel["claude-opus-4-8"].Contains("all"))
}
