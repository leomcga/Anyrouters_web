package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// B2B (enterprise customer) management.
//
// The generic option endpoints (/api/option) are Root-only (role=100), but B2B
// pricing must be manageable by ordinary admins (role=10). These handlers live
// under the AdminAuth-protected /api/group tree and expose ONLY the two options
// B2B pricing needs — GroupRatio (to create/keep the group) and GroupModelRatio
// (per-group, per-model discount overrides). This keeps the admin's blast
// radius to B2B pricing alone; every other system option stays Root-only.

// GetB2BPricing returns the current group ratios and the per-group, per-model
// overrides so the admin UI can render and edit B2B discounts.
func GetB2BPricing(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"group_ratio":       ratio_setting.GroupRatio2JSONString(),
			"group_model_ratio": ratio_setting.GroupModelRatio2JSONString(),
		},
	})
}

type updateB2BPricingRequest struct {
	// GroupRatio is the full group -> scalar ratio map (JSON string). Optional:
	// sent when creating/keeping the B2B group itself.
	GroupRatio string `json:"group_ratio"`
	// GroupModelRatio is the full group -> (model -> multiplier) map (JSON
	// string). This is the core B2B per-vendor discount table.
	GroupModelRatio string `json:"group_model_ratio"`
}

// UpdateB2BPricing persists group ratio and/or the per-group per-model override
// table. Each field is validated with the same checker the Root option path
// uses, then written through model.UpdateOption (DB + in-memory refresh) so
// billing picks it up immediately and consistently for pre-consume and settle.
func UpdateB2BPricing(c *gin.Context) {
	var req updateB2BPricingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	if req.GroupRatio != "" {
		if err := ratio_setting.CheckGroupRatio(req.GroupRatio); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		if err := model.UpdateOption("GroupRatio", req.GroupRatio); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	if req.GroupModelRatio != "" {
		if err := ratio_setting.CheckGroupModelRatio(req.GroupModelRatio); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		if err := model.UpdateOption("GroupModelRatio", req.GroupModelRatio); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

type provisionB2BGroupRequest struct {
	// Group is the B2B group name to provision (e.g. "btob"). Defaults to "btob".
	Group string `json:"group"`
}

// ProvisionB2BGroup makes a B2B group actually usable end-to-end. Putting a
// user into a group is not enough: new-api routes requests via the ability
// table (model+group -> channel), so unless every serving channel also lists
// the group, B2B users can't call any model. This handler:
//  1. ensures the group exists in GroupRatio (ratio 1 = same base price; the
//     discount comes from GroupModelRatio),
//  2. appends the group to every channel's comma-separated group list and
//     rebuilds that channel's abilities.
//
// Idempotent: channels that already serve the group are left untouched.
func ProvisionB2BGroup(c *gin.Context) {
	var req provisionB2BGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	group := strings.TrimSpace(req.Group)
	if group == "" {
		group = "btob"
	}

	// 1. Ensure the group exists in GroupRatio.
	if !ratio_setting.ContainsGroupRatio(group) {
		ratios := ratio_setting.GetGroupRatioCopy()
		ratios[group] = 1
		jsonStr, err := common.Marshal(ratios)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if err := model.UpdateOption("GroupRatio", string(jsonStr)); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	// 2. Append the group to every channel that doesn't already serve it.
	channels, err := model.GetAllChannels(0, 0, true, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	updated := 0
	for _, ch := range channels {
		groups := strings.Split(strings.Trim(ch.Group, ","), ",")
		has := false
		for _, g := range groups {
			if strings.TrimSpace(g) == group {
				has = true
				break
			}
		}
		if has {
			continue
		}
		groups = append(groups, group)
		ch.Group = strings.Join(groups, ",")
		if err := ch.Update(); err != nil {
			common.ApiError(c, err)
			return
		}
		updated++
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"group":            group,
			"channels_updated": updated,
		},
	})
}
