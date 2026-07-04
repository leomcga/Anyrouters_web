package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Native in-app support tickets. The user is already authenticated (session
// cookie), so tickets carry their identity automatically — no second login and
// no "tell us your account number". Staff answer from the admin panel.

// A ticket message is text/markdown that may embed base64 screenshots. 2MB caps
// one message so a pasted image can't blow up a row while staying generous.
const maxTicketMessageBytes = 2 * 1024 * 1024
const maxTicketTitleLen = 200

func actorName(c *gin.Context) string {
	if n := c.GetString("username"); n != "" {
		return n
	}
	return "user"
}

// CreateTicket — user opens a new ticket.
func CreateTicket(c *gin.Context) {
	var req struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	if title == "" || content == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "标题和内容不能为空"})
		return
	}
	if len([]rune(title)) > maxTicketTitleLen {
		title = string([]rune(title)[:maxTicketTitleLen])
	}
	if len(content) > maxTicketMessageBytes {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "内容过长（含图片时请压缩）"})
		return
	}
	ticket, err := model.CreateTicket(c.GetInt("id"), actorName(c), title, content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ticket})
}

// GetSelfTickets — user's own ticket list.
func GetSelfTickets(c *gin.Context) {
	tickets, err := model.GetUserTickets(c.GetInt("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": tickets})
}

// GetSelfTicket — one of the user's own tickets with its thread; marks the
// user's unread flag cleared (they just opened it).
func GetSelfTicket(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	uid := c.GetInt("id")
	ticket, err := model.GetTicketWithMessages(id, uid)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.MarkTicketRead(id, uid, "user")
	ticket.UserUnread = false
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ticket})
}

// ReplySelfTicket — user replies on their own ticket.
func ReplySelfTicket(c *gin.Context) {
	replyTicket(c, c.GetInt("id"), "user")
}

// CloseSelfTicket — user closes their own ticket.
func CloseSelfTicket(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := model.SetTicketStatus(id, c.GetInt("id"), model.TicketStatusClosed); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetSelfTicketUnread — badge count for the user sidebar.
func GetSelfTicketUnread(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": model.CountUserUnreadTickets(c.GetInt("id"))})
}

// ---- Admin (staff) ----

// GetAllTickets — admin list of every ticket, with opener identity.
func GetAllTickets(c *gin.Context) {
	status := c.Query("status")
	page, _ := strconv.Atoi(c.Query("p"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(c.Query("page_size"))
	if size <= 0 || size > 100 {
		size = 20
	}
	tickets, total, err := model.GetAllTicketsForAdmin(status, (page-1)*size, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"items": tickets, "total": total, "page": page, "page_size": size,
		"admin_unread": model.CountAdminUnreadTickets(),
	}})
}

// GetTicketByAdmin — any ticket + thread; clears the admin unread flag.
func GetTicketByAdmin(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	ticket, err := model.GetTicketWithMessages(id, 0)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.MarkTicketRead(id, 0, "admin")
	ticket.AdminUnread = false
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ticket})
}

// ReplyTicketByAdmin — staff replies to any ticket.
func ReplyTicketByAdmin(c *gin.Context) {
	replyTicket(c, 0, "admin")
}

// SetTicketStatusByAdmin — staff close/reopen.
func SetTicketStatusByAdmin(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req struct {
		Status string `json:"status"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.SetTicketStatus(id, 0, req.Status); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// replyTicket is the shared reply path. enforceUserId=0 for admin (any ticket),
// or the user's id for self (own tickets only).
func replyTicket(c *gin.Context, enforceUserId int, role string) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req struct {
		Content string `json:"content"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "回复内容不能为空"})
		return
	}
	if len(content) > maxTicketMessageBytes {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "内容过长（含图片时请压缩）"})
		return
	}
	ticket, err := model.AddTicketMessage(id, enforceUserId, role, c.GetInt("id"), actorName(c), content)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": ticket})
}
