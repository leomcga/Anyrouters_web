package openai

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/QuantumNous/new-api/common"
)

var azureUnsupportedRootSchemaKeywords = []string{
	"oneOf",
	"anyOf",
	"allOf",
	"enum",
	"const",
	"not",
}

// normalizeAzureResponsesTools converts composed top-level function schemas
// into the object shape required by Azure Responses. Nested property schemas
// remain intact.
func normalizeAzureResponsesTools(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return raw, nil
	}

	var tools []map[string]any
	if err := common.UnmarshalUseNumber(raw, &tools); err != nil {
		return nil, fmt.Errorf("decode responses tools: %w", err)
	}

	changed := false
	for _, tool := range tools {
		if normalizeAzureResponsesTool(tool) {
			changed = true
		}
	}

	if !changed {
		return raw, nil
	}
	normalized, err := common.Marshal(tools)
	if err != nil {
		return nil, fmt.Errorf("encode normalized responses tools: %w", err)
	}
	return normalized, nil
}

// normalizeAzureResponsesInputTools applies the same schema compatibility
// conversion to tools returned by historical tool_search_output items.
func normalizeAzureResponsesInputTools(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return raw, nil
	}
	if common.GetJsonType(raw) != "array" {
		return raw, nil
	}

	var items []json.RawMessage
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("decode responses input: %w", err)
	}

	changed := false
	for index, rawItem := range items {
		if common.GetJsonType(rawItem) != "object" {
			continue
		}

		var item map[string]json.RawMessage
		if err := common.Unmarshal(rawItem, &item); err != nil {
			return nil, fmt.Errorf("decode responses input item: %w", err)
		}

		var itemType string
		if err := common.Unmarshal(item["type"], &itemType); err != nil || itemType != "tool_search_output" {
			continue
		}

		rawTools, ok := item["tools"]
		if !ok {
			continue
		}
		normalizedTools, err := normalizeAzureResponsesTools(rawTools)
		if err != nil {
			return nil, fmt.Errorf("normalize historical responses tools: %w", err)
		}
		if bytes.Equal(normalizedTools, rawTools) {
			continue
		}

		item["tools"] = normalizedTools
		normalizedItem, err := common.Marshal(item)
		if err != nil {
			return nil, fmt.Errorf("encode normalized responses input item: %w", err)
		}
		items[index] = normalizedItem
		changed = true
	}

	if !changed {
		return raw, nil
	}
	normalized, err := common.Marshal(items)
	if err != nil {
		return nil, fmt.Errorf("encode normalized responses input: %w", err)
	}
	return normalized, nil
}

func normalizeAzureResponsesTool(tool map[string]any) bool {
	switch tool["type"] {
	case "function":
		parameters, ok := tool["parameters"].(map[string]any)
		if !ok {
			return false
		}
		normalized, changed := normalizeAzureFunctionParameters(parameters)
		if changed {
			tool["parameters"] = normalized
		}
		return changed
	case "namespace":
		nestedTools, ok := tool["tools"].([]any)
		if !ok {
			return false
		}
		changed := false
		for _, nestedTool := range nestedTools {
			nestedToolMap, ok := nestedTool.(map[string]any)
			if !ok {
				continue
			}
			if normalizeAzureResponsesTool(nestedToolMap) {
				changed = true
			}
		}
		return changed
	default:
		return false
	}
}

func normalizeAzureFunctionParameters(schema map[string]any) (map[string]any, bool) {
	if schema["type"] == "object" && !hasUnsupportedRootSchemaKeyword(schema) {
		return schema, false
	}

	branches := expandObjectSchemaBranches(schema)

	propertyVariants := make(map[string][]any)
	for _, branch := range branches {
		properties, _ := branch["properties"].(map[string]any)
		for name, propertySchema := range properties {
			propertyVariants[name] = append(propertyVariants[name], propertySchema)
		}
	}

	normalized := copySchemaWithoutKeys(schema, azureUnsupportedRootSchemaKeywords...)
	normalized["type"] = "object"

	if len(propertyVariants) > 0 {
		properties := make(map[string]any, len(propertyVariants))
		for name, variants := range propertyVariants {
			properties[name] = mergePropertySchemaVariants(variants)
		}
		normalized["properties"] = properties
	}

	if required := intersectRequiredProperties(branches); len(required) > 0 {
		normalized["required"] = required
	} else {
		delete(normalized, "required")
	}

	if everyBranchRejectsAdditionalProperties(branches) {
		normalized["additionalProperties"] = false
	} else {
		delete(normalized, "additionalProperties")
	}

	return normalized, true
}

func hasUnsupportedRootSchemaKeyword(schema map[string]any) bool {
	for _, key := range azureUnsupportedRootSchemaKeywords {
		if _, ok := schema[key]; ok {
			return true
		}
	}
	return false
}

func expandObjectSchemaBranches(schema map[string]any) []map[string]any {
	for _, keyword := range []string{"oneOf", "anyOf"} {
		rawBranches, ok := schema[keyword].([]any)
		if !ok || len(rawBranches) == 0 {
			continue
		}

		base := copySchemaWithoutKeys(schema, keyword)
		expanded := make([]map[string]any, 0, len(rawBranches))
		for _, rawBranch := range rawBranches {
			branch, ok := rawBranch.(map[string]any)
			if !ok {
				continue
			}
			expanded = append(expanded, expandObjectSchemaBranches(
				mergeConjunctiveObjectSchemas(base, branch),
			)...)
		}
		if len(expanded) > 0 {
			return expanded
		}
	}

	if rawParts, ok := schema["allOf"].([]any); ok && len(rawParts) > 0 {
		merged := copySchemaWithoutKeys(schema, "allOf")
		for _, rawPart := range rawParts {
			part, ok := rawPart.(map[string]any)
			if !ok {
				continue
			}
			merged = mergeConjunctiveObjectSchemas(merged, part)
		}
		return expandObjectSchemaBranches(merged)
	}

	return []map[string]any{schema}
}

func mergeConjunctiveObjectSchemas(left, right map[string]any) map[string]any {
	merged := copySchemaWithoutKeys(left)
	for key, value := range right {
		switch key {
		case "properties", "$defs":
			leftMap, _ := merged[key].(map[string]any)
			rightMap, _ := value.(map[string]any)
			combined := make(map[string]any, len(leftMap)+len(rightMap))
			for name, item := range leftMap {
				combined[name] = item
			}
			for name, item := range rightMap {
				combined[name] = item
			}
			merged[key] = combined
		case "required":
			merged[key] = unionStringArrays(merged[key], value)
		default:
			merged[key] = value
		}
	}
	return merged
}

func mergePropertySchemaVariants(variants []any) any {
	unique := deduplicateSchemas(variants)
	if len(unique) == 1 {
		return unique[0]
	}
	return map[string]any{"anyOf": unique}
}

func deduplicateSchemas(values []any) []any {
	unique := make([]any, 0, len(values))
	seen := make(map[string]struct{})
	for _, value := range values {
		encoded, err := common.Marshal(value)
		if err != nil {
			unique = append(unique, value)
			continue
		}
		key := string(encoded)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func intersectRequiredProperties(branches []map[string]any) []any {
	if len(branches) == 0 {
		return nil
	}

	first := stringArray(branches[0]["required"])
	if len(first) == 0 {
		return nil
	}
	required := make(map[string]struct{}, len(first))
	for _, name := range first {
		required[name] = struct{}{}
	}

	for _, branch := range branches[1:] {
		current := make(map[string]struct{})
		for _, name := range stringArray(branch["required"]) {
			current[name] = struct{}{}
		}
		for name := range required {
			if _, ok := current[name]; !ok {
				delete(required, name)
			}
		}
	}

	result := make([]any, 0, len(required))
	for _, name := range first {
		if _, ok := required[name]; ok {
			result = append(result, name)
		}
	}
	return result
}

func everyBranchRejectsAdditionalProperties(branches []map[string]any) bool {
	if len(branches) == 0 {
		return false
	}
	for _, branch := range branches {
		rejects, ok := branch["additionalProperties"].(bool)
		if !ok || rejects {
			return false
		}
	}
	return true
}

func unionStringArrays(left, right any) []any {
	result := make([]any, 0)
	seen := make(map[string]struct{})
	for _, source := range []any{left, right} {
		for _, value := range stringArray(source) {
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			result = append(result, value)
		}
	}
	return result
}

func stringArray(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func copySchemaWithoutKeys(schema map[string]any, keys ...string) map[string]any {
	skip := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		skip[key] = struct{}{}
	}
	copied := make(map[string]any, len(schema))
	for key, value := range schema {
		if _, ok := skip[key]; ok {
			continue
		}
		copied[key] = value
	}
	return copied
}
