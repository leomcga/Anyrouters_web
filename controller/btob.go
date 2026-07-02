package controller

import (
	"fmt"
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

	updated, err := provisionGroup(group)
	if err != nil {
		common.ApiError(c, err)
		return
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

// provisionGroup is the reusable core behind ProvisionB2BGroup / customer moves:
// it ensures the group exists in GroupRatio (ratio 1 — the discount lives in
// GroupModelRatio) and appends the group to every serving channel's group list
// (rebuilding abilities via Channel.Update), so users in that group can actually
// reach every model. Returns the number of channels updated. Idempotent.
func provisionGroup(group string) (int, error) {
	// 1. Ensure the group exists in GroupRatio.
	if !ratio_setting.ContainsGroupRatio(group) {
		ratios := ratio_setting.GetGroupRatioCopy()
		ratios[group] = 1
		jsonStr, err := common.Marshal(ratios)
		if err != nil {
			return 0, err
		}
		if err := model.UpdateOption("GroupRatio", string(jsonStr)); err != nil {
			return 0, err
		}
	}

	// 2. Append the group to every channel that doesn't already serve it.
	channels, err := model.GetAllChannels(0, 0, true, true)
	if err != nil {
		return 0, err
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
			return 0, err
		}
		updated++
	}
	return updated, nil
}

// dedicatedGroupForUser is the canonical per-customer group name. Using the
// numeric user id keeps it stable and unique (usernames are opaque OIDC strings
// and can't be relied on). Matches the "b2b_%" filter in ListB2BCustomers.
func dedicatedGroupForUser(userId int) string {
	return fmt.Sprintf("b2b_%d", userId)
}

// b2bCustomer is the flattened per-customer view the admin UI renders: identity
// + which group it bills under + balance/usage. Discounts themselves come from
// GetB2BPricing (group_model_ratio keyed by group).
type b2bCustomer struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Group       string `json:"group"`
	Remark      string `json:"remark"`
	Quota       int    `json:"quota"`
	UsedQuota   int    `json:"used_quota"`
}

// GetB2BCustomers lists every B2B customer — those in the shared "btob" group
// AND those in a per-customer dedicated "b2b_<id>" group. A plain group=btob
// filter would miss dedicated-group customers, so this uses the dedicated
// ListB2BCustomers query.
func GetB2BCustomers(c *gin.Context) {
	users, err := model.ListB2BCustomers()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	out := make([]b2bCustomer, 0, len(users))
	for _, u := range users {
		out = append(out, b2bCustomer{
			Id:          u.Id,
			Username:    u.Username,
			DisplayName: u.DisplayName,
			Email:       u.Email,
			Group:       u.Group,
			Remark:      u.Remark,
			Quota:       u.Quota,
			UsedQuota:   u.UsedQuota,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": out})
}

type moveB2BCustomerRequest struct {
	// UserId is the customer to move.
	UserId int `json:"user_id"`
	// Group is the target group. Special values:
	//   ""            -> auto-create/use the dedicated group b2b_<UserId>
	//   "default"     -> remove from B2B (back to the C-end default group)
	//   any other name-> move into that existing/shared group (btob, a shared
	//                    tier, or another dedicated group)
	Group string `json:"group"`
}

// MoveB2BCustomer moves a customer between groups: into their dedicated group
// (auto-created + provisioned, inheriting the shared btob discount as a
// starting point), into any shared/existing group, or back to "default" to drop
// them out of B2B. Only the user's group changes (balance/identity preserved),
// and the target group is provisioned so the customer can actually call models.
func MoveB2BCustomer(c *gin.Context) {
	var req moveB2BCustomerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.UserId <= 0 {
		common.ApiErrorMsg(c, "user_id is required")
		return
	}

	user, err := model.GetUserById(req.UserId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	target := strings.TrimSpace(req.Group)
	if target == "" {
		target = dedicatedGroupForUser(req.UserId)
	}

	// Moving into a B2B group (not plain default): provision it and, if it's a
	// brand-new dedicated group with no discount yet, seed it from the shared
	// btob table so the customer starts at the standard B2B discount.
	if target != "default" {
		if _, err := provisionGroup(target); err != nil {
			common.ApiError(c, err)
			return
		}
		if err := seedGroupDiscountFromBtob(target); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	user.Group = target
	if err := user.Edit(false); err != nil {
		common.ApiError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"user_id": req.UserId, "group": target},
	})
}

// seedGroupDiscountFromBtob gives a group that has no per-model override yet a
// starting discount copied from the shared "btob" table, so a freshly created
// dedicated group bills at the standard B2B discount until the admin customizes
// it. No-op if the group already has overrides (never clobbers a customized
// group) or if btob has none.
func seedGroupDiscountFromBtob(group string) error {
	full := ratio_setting.GetGroupModelRatioCopy()
	if len(full[group]) > 0 {
		return nil // already customized — leave it
	}
	btob := full["btob"]
	if len(btob) == 0 {
		return nil // nothing to seed from
	}
	seeded := make(map[string]float64, len(btob))
	for k, v := range btob {
		seeded[k] = v
	}
	full[group] = seeded
	jsonStr, err := common.Marshal(full)
	if err != nil {
		return err
	}
	return model.UpdateOption("GroupModelRatio", string(jsonStr))
}

type updateGroupPricingRequest struct {
	// Group is the group whose per-model discount table is being edited.
	Group string `json:"group"`
	// Models maps model name -> multiplier for THIS group only. Replaces this
	// group's entry wholesale; other groups are untouched.
	Models map[string]float64 `json:"models"`
}

// UpdateB2BGroupPricing edits ONE group's per-model discount table without
// touching any other group. It reads the full GroupModelRatio, replaces just
// this group's entry, and writes it back — so per-customer (dedicated group)
// pricing can be tuned freely and independently.
func UpdateB2BGroupPricing(c *gin.Context) {
	var req updateGroupPricingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	group := strings.TrimSpace(req.Group)
	if group == "" {
		common.ApiErrorMsg(c, "group is required")
		return
	}
	for name, ratio := range req.Models {
		if ratio < 0 {
			common.ApiErrorMsg(c, "group model ratio must be not less than 0: "+name)
			return
		}
	}

	full := ratio_setting.GetGroupModelRatioCopy()
	if len(req.Models) == 0 {
		delete(full, group)
	} else {
		full[group] = req.Models
	}
	jsonStr, err := common.Marshal(full)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption("GroupModelRatio", string(jsonStr)); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
