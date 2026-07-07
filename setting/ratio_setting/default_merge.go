package ratio_setting

import "github.com/QuantumNous/new-api/types"

var modelRatioCompatibilityDefaults = map[string]float64{
	"claude-sonnet-4-6": 1.5,
}

var cacheRatioCompatibilityDefaults = map[string]float64{
	"claude-sonnet-4-6": 0.1,
}

var createCacheRatioCompatibilityDefaults = map[string]float64{
	"claude-sonnet-4-6": 1.25,
}

func mergeMissingFloatDefaults(target *types.RWMap[string, float64], defaults map[string]float64) {
	for key, value := range defaults {
		if _, exists := target.Get(key); exists {
			continue
		}
		target.Set(key, value)
	}
}
