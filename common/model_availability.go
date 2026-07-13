package common

import (
	"path"
	"strings"
)

const temporarilyUnavailableModelsEnv = "TEMPORARILY_UNAVAILABLE_MODELS"

// IsModelTemporarilyUnavailable matches a model against a comma-separated
// list of case-insensitive shell patterns such as "*claude*".
func IsModelTemporarilyUnavailable(modelName string) bool {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	if modelName == "" {
		return false
	}
	for _, rawPattern := range strings.Split(GetEnvOrDefaultString(temporarilyUnavailableModelsEnv, ""), ",") {
		pattern := strings.ToLower(strings.TrimSpace(rawPattern))
		if pattern == "" {
			continue
		}
		matched, err := path.Match(pattern, modelName)
		if err == nil && matched {
			return true
		}
	}
	return false
}
