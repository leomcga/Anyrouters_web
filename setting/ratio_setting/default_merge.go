package ratio_setting

import "github.com/QuantumNous/new-api/types"

var modelRatioCompatibilityDefaults = map[string]float64{
	"claude-sonnet-4-6": 1.5,
	"gpt-5.2":           0.875,
	"gpt-5.2-codex":     0.875,
	"gpt-5.3-codex":     0.875,
	"gpt-5.4":           1.25,
	"gpt-5.4-mini":      0.375,
	"gpt-5.4-pro":       15.0,
	"gpt-5.5":           2.5,
}

var cacheRatioCompatibilityDefaults = map[string]float64{
	"claude-sonnet-4-6": 0.1,
	"gpt-5.2":           0.1,
	"gpt-5.2-codex":     0.1,
	"gpt-5.3-codex":     0.1,
	"gpt-5.4":           0.1,
	"gpt-5.4-mini":      0.1,
	"gpt-5.4-pro":       0.1,
	"gpt-5.5":           0.1,
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
