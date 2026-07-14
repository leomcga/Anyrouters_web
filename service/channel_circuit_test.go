package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestChannelCircuitOpensHalfOpensAndRecovers(t *testing.T) {
	const now int64 = 1_000
	state := channelCircuitState{}
	for i := 0; i < 2; i++ {
		var opened bool
		state, opened = applyChannelCircuitFailure(state, now, 3, 60, false)
		require.False(t, opened)
	}
	state, opened := applyChannelCircuitFailure(state, now, 3, 60, false)
	require.True(t, opened)

	allowed, retryAfter, state := evaluateChannelCircuit(state, now+10, 3, 1)
	require.False(t, allowed)
	require.EqualValues(t, 50, retryAfter)

	allowed, _, state = evaluateChannelCircuit(state, now+61, 3, 1)
	require.True(t, allowed)
	require.EqualValues(t, 1, state.Probes)

	allowed, _, _ = evaluateChannelCircuit(state, now+61, 3, 1)
	require.False(t, allowed)

	state = channelCircuitState{}
	allowed, _, _ = evaluateChannelCircuit(state, now+62, 3, 1)
	require.True(t, allowed)
}

func TestSevereChannelFailureOpensImmediately(t *testing.T) {
	state, opened := applyChannelCircuitFailure(channelCircuitState{}, 100, 5, 60, true)
	require.True(t, opened)
	require.EqualValues(t, 160, state.OpenUntil)
}
