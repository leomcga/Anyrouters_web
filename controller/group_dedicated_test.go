package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsDedicatedB2BGroupOnlyMatchesCanonicalUserID(t *testing.T) {
	require.True(t, isDedicatedB2BGroup("b2b_16"))
	require.False(t, isDedicatedB2BGroup("b2b_enterprise"))
	require.False(t, isDedicatedB2BGroup("b2b_001"))
	require.False(t, isDedicatedB2BGroup("b2b_0"))
	require.False(t, isDedicatedB2BGroup("b2b_16_extra"))
}
