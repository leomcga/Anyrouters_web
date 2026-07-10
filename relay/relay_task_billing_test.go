package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/require"
)

func TestApplyTaskOtherRatiosRoundsOnlyOnce(t *testing.T) {
	ratios := map[string]float64{
		"seconds":    8,
		"resolution": 1.2,
		"audio":      5.0 / 6.0,
	}

	require.Equal(t, 59, service.ApplyTaskOtherRatios(7.4, ratios))
}

func TestApplyTaskOtherRatiosIgnoresInvalidValues(t *testing.T) {
	ratios := map[string]float64{
		"valid":    2,
		"zero":     0,
		"negative": -1,
	}

	require.Equal(t, 14, service.ApplyTaskOtherRatios(7, ratios))
}
