package ratio_setting

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
)

var defaultGroupRatio = map[string]float64{
	"default": 1,
	"vip":     1,
	"svip":    1,
}

var groupRatioMap = types.NewRWMap[string, float64]()

var defaultGroupGroupRatio = map[string]map[string]float64{
	"vip": {
		"edit_this": 0.9,
	},
}

var groupGroupRatioMap = types.NewRWMap[string, map[string]float64]()

// groupModelRatioMap holds a per-group, per-model multiplier that is applied ON
// TOP of the group ratio during billing. It lets B2B (enterprise) groups get a
// different effective discount per vendor/model than C-end users — e.g. Claude
// at 8.5折 while GPT/Gemini at 6折 — which a single scalar group ratio cannot
// express. Shape: { groupName: { modelName: multiplier } }. A missing entry
// means "no override" (multiplier = 1), never a discount.
var groupModelRatioMap = types.NewRWMap[string, map[string]float64]()

var defaultGroupSpecialUsableGroup = map[string]map[string]string{
	"vip": {
		"append_1":   "vip_special_group_1",
		"-:remove_1": "vip_removed_group_1",
	},
}

type GroupRatioSetting struct {
	GroupRatio              *types.RWMap[string, float64]            `json:"group_ratio"`
	GroupGroupRatio         *types.RWMap[string, map[string]float64] `json:"group_group_ratio"`
	GroupModelRatio         *types.RWMap[string, map[string]float64] `json:"group_model_ratio"`
	GroupSpecialUsableGroup *types.RWMap[string, map[string]string]  `json:"group_special_usable_group"`
}

var groupRatioSetting GroupRatioSetting

func init() {
	groupSpecialUsableGroup := types.NewRWMap[string, map[string]string]()
	groupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)

	groupRatioMap.AddAll(defaultGroupRatio)
	groupGroupRatioMap.AddAll(defaultGroupGroupRatio)

	groupRatioSetting = GroupRatioSetting{
		GroupSpecialUsableGroup: groupSpecialUsableGroup,
		GroupRatio:              groupRatioMap,
		GroupGroupRatio:         groupGroupRatioMap,
		GroupModelRatio:         groupModelRatioMap,
	}

	config.GlobalConfig.Register("group_ratio_setting", &groupRatioSetting)
}

func GetGroupRatioSetting() *GroupRatioSetting {
	if groupRatioSetting.GroupSpecialUsableGroup == nil {
		groupRatioSetting.GroupSpecialUsableGroup = types.NewRWMap[string, map[string]string]()
		groupRatioSetting.GroupSpecialUsableGroup.AddAll(defaultGroupSpecialUsableGroup)
	}
	return &groupRatioSetting
}

func GetGroupRatioCopy() map[string]float64 {
	return groupRatioMap.ReadAll()
}

func ContainsGroupRatio(name string) bool {
	_, ok := groupRatioMap.Get(name)
	return ok
}

func GroupRatio2JSONString() string {
	return groupRatioMap.MarshalJSONString()
}

func UpdateGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupRatioMap, jsonStr)
}

func GetGroupRatio(name string) float64 {
	ratio, ok := groupRatioMap.Get(name)
	if !ok {
		common.SysLog("group ratio not found: " + name)
		return 1
	}
	return ratio
}

func GetGroupGroupRatio(userGroup, usingGroup string) (float64, bool) {
	gp, ok := groupGroupRatioMap.Get(userGroup)
	if !ok {
		return -1, false
	}
	ratio, ok := gp[usingGroup]
	if !ok {
		return -1, false
	}
	return ratio, true
}

func GroupGroupRatio2JSONString() string {
	return groupGroupRatioMap.MarshalJSONString()
}

func UpdateGroupGroupRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupGroupRatioMap, jsonStr)
}

// GetGroupModelRatio returns the per-group, per-model billing multiplier and
// whether it exists. Applied on top of the group ratio; a missing entry means
// no override (caller should treat as 1). Used by both pre-consume and settle
// so the two stay consistent.
//
// The model name is normalized through FormatMatchingModelName + the compact
// wildcard fallback so that lookups match EXACTLY the way GetModelRatio /
// GetModelPrice / GetCompletionRatio / GetCacheRatio do. Without this, a request
// whose raw model name carries a variant suffix (Codex `-openai-compact`, Gemini
// thinking-budget, gpt gizmo, dated Claude ids, …) would find its price under a
// normalized/wildcard key but MISS its discount override under the raw name,
// silently billing that request at full price for B2B groups. Keeping the two
// key spaces identical here is the single source of truth for model matching.
func GetGroupModelRatio(group, modelName string) (float64, bool) {
	models, ok := groupModelRatioMap.Get(group)
	if !ok {
		return 1, false
	}

	name := FormatMatchingModelName(modelName)
	if ratio, ok := models[name]; ok {
		return ratio, true
	}

	// Compact wildcard fallback, mirroring GetModelRatio/GetModelPrice: an
	// `*-openai-compact` override applies to any `<model>-openai-compact` name.
	if strings.HasSuffix(name, CompactModelSuffix) {
		if ratio, ok := models[CompactWildcardModelKey]; ok {
			return ratio, true
		}
	}

	return 1, false
}

func GroupModelRatio2JSONString() string {
	return groupModelRatioMap.MarshalJSONString()
}

func UpdateGroupModelRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(groupModelRatioMap, jsonStr)
}

// CheckGroupModelRatio validates a group_model_ratio JSON blob: it must be a
// map of group -> (model -> multiplier), with every multiplier >= 0.
func CheckGroupModelRatio(jsonStr string) error {
	check := make(map[string]map[string]float64)
	if err := json.Unmarshal([]byte(jsonStr), &check); err != nil {
		return err
	}
	for group, models := range check {
		for name, ratio := range models {
			if ratio < 0 {
				return errors.New("group model ratio must be not less than 0: " + group + "/" + name)
			}
		}
	}
	return nil
}

func CheckGroupRatio(jsonStr string) error {
	checkGroupRatio := make(map[string]float64)
	err := json.Unmarshal([]byte(jsonStr), &checkGroupRatio)
	if err != nil {
		return err
	}
	for name, ratio := range checkGroupRatio {
		if ratio < 0 {
			return errors.New("group ratio must be not less than 0: " + name)
		}
	}
	return nil
}
