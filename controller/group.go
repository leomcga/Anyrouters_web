package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// isDedicatedB2BGroup reports whether a group is a per-customer dedicated B2B
// group (auto-provisioned as "b2b_<userId>", see controller/btob.go). These are
// an internal billing construct — a customer's traffic is already pinned to
// their group by the admin, so the raw "b2b_16"-style name must never be shown
// as a selectable option in the console (it leaks the internal naming and
// wrongly implies the user can switch their own billing tier). The shared
// "btob" tier and any manually-named group are NOT dedicated and are unaffected.
func isDedicatedB2BGroup(groupName string) bool {
	return strings.HasPrefix(groupName, "b2b_")
}

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetUserUsableGroups(userGroup)
	for groupName, _ := range ratio_setting.GetGroupRatioCopy() {
		// Never expose a customer's dedicated "b2b_<id>" group in the console:
		// it's an internal billing tier, not a user-selectable option. Billing
		// is pinned to the user's real group server-side regardless of this list.
		if isDedicatedB2BGroup(groupName) {
			continue
		}
		// UserUsableGroups contains the groups that the user can use
		if desc, ok := userUsableGroups[groupName]; ok {
			usableGroups[groupName] = map[string]interface{}{
				"ratio": service.GetUserGroupRatio(userGroup, groupName),
				"desc":  desc,
			}
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]interface{}{
			"ratio": "自动",
			"desc":  setting.GetUsableGroupDescription("auto"),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
