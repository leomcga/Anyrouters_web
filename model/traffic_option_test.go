package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestTrafficOptionsUpdateDynamicallyAndRejectUnlimitedValues(t *testing.T) {
	oldMap := common.OptionMap
	oldLimit := common.TrafficUserRPMLimit
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		common.OptionMap = oldMap
		common.TrafficConfigRWMutex.Lock()
		common.TrafficUserRPMLimit = oldLimit
		common.TrafficConfigRWMutex.Unlock()
	})

	require.NoError(t, updateOptionMap("TrafficUserRPMLimit", "123"))
	require.EqualValues(t, 123, common.GetTrafficControlConfig().UserRPM)
	require.Error(t, updateOptionMap("TrafficUserRPMLimit", "0"))
	require.EqualValues(t, 123, common.GetTrafficControlConfig().UserRPM)
}
