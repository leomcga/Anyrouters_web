package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPricingGroupsForUserPinsB2BUsersToCurrentBillingGroup(t *testing.T) {
	usable := map[string]string{
		"default": "Default",
		"vip":     "VIP",
		"b2b_16":  "Customer group",
	}

	require.Equal(t, map[string]string{
		"b2b_16": "Customer group",
	}, pricingGroupsForUser("b2b_16", usable))
}

func TestPricingGroupsForUserKeepsOrdinaryUserChoices(t *testing.T) {
	usable := map[string]string{
		"default": "Default",
		"vip":     "VIP",
	}

	require.Equal(t, usable, pricingGroupsForUser("default", usable))
}
