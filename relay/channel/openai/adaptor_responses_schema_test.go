package openai

import (
	"reflect"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestConvertOpenAIResponsesRequestNormalizesComposedFunctionSchemaForAzure(t *testing.T) {
	request := dto.OpenAIResponsesRequest{
		Model: "gpt-5.6-sol",
		Tools: []byte(`[
			{
				"type": "function",
				"name": "automation_update",
				"description": "Create, update, view, or delete recurring automations.",
				"parameters": {
					"oneOf": [
						{
							"type": "object",
							"properties": {
								"mode": {"type": "string", "const": "view"},
								"id": {"$ref": "#/$defs/id"}
							},
							"required": ["mode", "id"],
							"additionalProperties": false
						},
						{
							"oneOf": [
								{
									"type": "object",
									"properties": {
										"mode": {"$ref": "#/$defs/create_mode"},
										"kind": {"$ref": "#/$defs/cron_kind"},
										"name": {"$ref": "#/$defs/non_empty_string"},
										"cwds": {"$ref": "#/$defs/cwds"}
									},
									"required": ["mode", "kind", "name", "cwds"],
									"additionalProperties": false
								},
								{
									"type": "object",
									"properties": {
										"mode": {"$ref": "#/$defs/create_mode"},
										"kind": {"$ref": "#/$defs/heartbeat_kind"},
										"name": {"$ref": "#/$defs/non_empty_string"},
										"targetThreadId": {"$ref": "#/$defs/non_empty_string"}
									},
									"required": ["mode", "kind", "name"],
									"additionalProperties": false
								}
							]
						},
						{
							"oneOf": [
								{
									"type": "object",
									"properties": {
										"mode": {"$ref": "#/$defs/update_mode"},
										"id": {"$ref": "#/$defs/id"},
										"kind": {"$ref": "#/$defs/cron_kind"},
										"name": {"$ref": "#/$defs/non_empty_string"},
										"cwds": {"$ref": "#/$defs/cwds"}
									},
									"required": ["mode", "id", "kind", "name", "cwds"],
									"additionalProperties": false
								},
								{
									"type": "object",
									"properties": {
										"mode": {"$ref": "#/$defs/update_mode"},
										"id": {"$ref": "#/$defs/id"},
										"kind": {"$ref": "#/$defs/heartbeat_kind"},
										"name": {"$ref": "#/$defs/non_empty_string"},
										"targetThreadId": {"$ref": "#/$defs/non_empty_string"}
									},
									"required": ["mode", "id", "kind", "name"],
									"additionalProperties": false
								}
							]
						},
						{
							"type": "object",
							"properties": {
								"mode": {"type": "string", "const": "delete"},
								"id": {"$ref": "#/$defs/id"}
							},
							"required": ["mode", "id"],
							"additionalProperties": false
						}
					],
					"$defs": {
						"id": {"type": "string", "minLength": 1},
						"non_empty_string": {"type": "string", "minLength": 1},
						"create_mode": {"type": "string", "enum": ["create", "suggested_create"]},
						"update_mode": {"type": "string", "enum": ["update", "suggested_update"]},
						"cron_kind": {"type": "string", "const": "cron"},
						"heartbeat_kind": {"type": "string", "const": "heartbeat"},
						"cwds": {
							"anyOf": [
								{"type": "string"},
								{"type": "array", "items": {"type": "string"}}
							]
						}
					}
				}
			}
		]`),
	}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(
		nil,
		&relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		},
		request,
	)
	if err != nil {
		t.Fatalf("ConvertOpenAIResponsesRequest() error = %v", err)
	}

	got, ok := converted.(dto.OpenAIResponsesRequest)
	if !ok {
		t.Fatalf("converted request type = %T, want dto.OpenAIResponsesRequest", converted)
	}

	var tools []map[string]any
	if err := common.Unmarshal(got.Tools, &tools); err != nil {
		t.Fatalf("unmarshal tools: %v", err)
	}
	parameters, ok := tools[0]["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("parameters type = %T, want object", tools[0]["parameters"])
	}
	if parameters["type"] != "object" {
		t.Fatalf("parameters.type = %v, want object", parameters["type"])
	}
	if _, ok := parameters["oneOf"]; ok {
		t.Fatal("top-level oneOf must be flattened for Azure")
	}
	if _, ok := parameters["$defs"]; !ok {
		t.Fatal("normalization removed $defs references")
	}

	properties, ok := parameters["properties"].(map[string]any)
	if !ok {
		t.Fatalf("parameters.properties type = %T, want object", parameters["properties"])
	}
	for _, name := range []string{"mode", "id", "kind", "name", "cwds", "targetThreadId"} {
		if _, ok := properties[name]; !ok {
			t.Fatalf("normalized properties missing %q", name)
		}
	}

	required, ok := parameters["required"].([]any)
	if !ok {
		t.Fatalf("parameters.required type = %T, want array", parameters["required"])
	}
	if !reflect.DeepEqual(required, []any{"mode"}) {
		t.Fatalf("parameters.required = %#v, want [mode]", required)
	}

	assertAnyOfContains(t, properties["mode"], []string{
		`{"const":"view","type":"string"}`,
		`{"$ref":"#/$defs/create_mode"}`,
		`{"$ref":"#/$defs/update_mode"}`,
		`{"const":"delete","type":"string"}`,
	})
	assertAnyOfContains(t, properties["kind"], []string{
		`{"$ref":"#/$defs/cron_kind"}`,
		`{"$ref":"#/$defs/heartbeat_kind"}`,
	})
}

func TestConvertOpenAIResponsesRequestNormalizesFunctionSchemaInsideNamespaceForAzure(t *testing.T) {
	request := dto.OpenAIResponsesRequest{
		Model: "gpt-5.6-sol",
		Tools: []byte(`[
			{
				"type": "namespace",
				"name": "codex_app",
				"description": "Tools provided by the Codex app.",
				"tools": [
					{
						"type": "function",
						"name": "automation_update",
						"strict": false,
						"defer_loading": true,
						"parameters": {
							"oneOf": [
								{
									"type": "object",
									"properties": {
										"mode": {"type": "string", "enum": ["view"]},
										"id": {"$ref": "#/$defs/id"}
									},
									"required": ["mode", "id"],
									"additionalProperties": false
								},
								{
									"type": "object",
									"properties": {
										"mode": {"type": "string", "enum": ["delete"]},
										"id": {"$ref": "#/$defs/id"}
									},
									"required": ["mode", "id"],
									"additionalProperties": false
								}
							],
							"$defs": {
								"id": {"type": "string", "minLength": 1}
							}
						}
					}
				]
			},
			{
				"type": "tool_search"
			}
		]`),
	}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(
		nil,
		&relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		},
		request,
	)
	if err != nil {
		t.Fatalf("ConvertOpenAIResponsesRequest() error = %v", err)
	}

	got := converted.(dto.OpenAIResponsesRequest)
	var tools []map[string]any
	if err := common.Unmarshal(got.Tools, &tools); err != nil {
		t.Fatalf("unmarshal tools: %v", err)
	}
	if len(tools) != 2 || tools[1]["type"] != "tool_search" {
		t.Fatalf("tools = %#v, want namespace followed by tool_search", tools)
	}
	namespaceTools, ok := tools[0]["tools"].([]any)
	if !ok || len(namespaceTools) != 1 {
		t.Fatalf("namespace tools = %#v, want one nested function", tools[0]["tools"])
	}
	function, ok := namespaceTools[0].(map[string]any)
	if !ok {
		t.Fatalf("nested tool type = %T, want object", namespaceTools[0])
	}
	if function["defer_loading"] != true {
		t.Fatalf("nested defer_loading = %v, want true", function["defer_loading"])
	}
	parameters, ok := function["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("nested parameters type = %T, want object", function["parameters"])
	}
	if parameters["type"] != "object" {
		t.Fatalf("nested parameters.type = %v, want object", parameters["type"])
	}
	if _, ok := parameters["oneOf"]; ok {
		t.Fatal("nested top-level oneOf must be flattened for Azure")
	}
	if _, ok := parameters["$defs"]; !ok {
		t.Fatal("nested normalization removed $defs references")
	}
}

func TestConvertOpenAIResponsesRequestLeavesNonAzureToolSchemaUnchanged(t *testing.T) {
	tools := []byte(`[{"type":"function","name":"f","parameters":{"oneOf":[{"type":"object"}]}}]`)
	request := dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol", Tools: tools}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(
		nil,
		&relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeOpenAI},
		},
		request,
	)
	if err != nil {
		t.Fatalf("ConvertOpenAIResponsesRequest() error = %v", err)
	}
	got := converted.(dto.OpenAIResponsesRequest)
	if string(got.Tools) != string(tools) {
		t.Fatalf("non-Azure tools changed:\n got: %s\nwant: %s", got.Tools, tools)
	}
}

func TestConvertOpenAIResponsesRequestLeavesValidAzureToolSchemaUnchanged(t *testing.T) {
	tools := []byte(`[{"type":"function","name":"f","parameters":{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}}]`)
	request := dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol", Tools: tools}

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(
		nil,
		&relaycommon.RelayInfo{
			ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAzure},
		},
		request,
	)
	if err != nil {
		t.Fatalf("ConvertOpenAIResponsesRequest() error = %v", err)
	}
	got := converted.(dto.OpenAIResponsesRequest)
	if string(got.Tools) != string(tools) {
		t.Fatalf("valid Azure tools changed:\n got: %s\nwant: %s", got.Tools, tools)
	}
}

func assertAnyOfContains(t *testing.T, schemaValue any, want []string) {
	t.Helper()
	schema, ok := schemaValue.(map[string]any)
	if !ok {
		t.Fatalf("schema type = %T, want object", schemaValue)
	}
	rawAlternatives, ok := schema["anyOf"].([]any)
	if !ok {
		t.Fatalf("schema.anyOf type = %T, want array", schema["anyOf"])
	}
	got := make([]string, 0, len(rawAlternatives))
	for _, alternative := range rawAlternatives {
		encoded, err := common.Marshal(alternative)
		if err != nil {
			t.Fatalf("marshal schema alternative: %v", err)
		}
		got = append(got, string(encoded))
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("schema.anyOf = %#v, want %#v", got, want)
	}
}
