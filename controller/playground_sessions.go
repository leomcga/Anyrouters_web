package controller

import (
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Cloud persistence for playground conversations (UserAuth, no Distribute).
// The browser keeps localStorage as a cache and mirrors every change here, so
// history survives refreshes, crashes and device switches.

// A conversation's message JSON is image-free (the client strips generated
// pictures to idbimg:// refs before upload), so 1MB of text is far beyond any
// real conversation — treat bigger payloads as a client bug, not data.
const maxPlaygroundSessionBytes = 1024 * 1024

// GetPlaygroundSessions returns the user's conversations, newest first,
// messages included (the list is capped server-side, and rows are text-only).
func GetPlaygroundSessions(c *gin.Context) {
	sessions, err := model.GetPlaygroundSessions(c.GetInt("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": sessions})
}

// UpsertPlaygroundSession creates or updates one conversation by its
// client-generated id.
func UpsertPlaygroundSession(c *gin.Context) {
	var req struct {
		Id        string `json:"id"`
		Title     string `json:"title"`
		Messages  string `json:"messages"`
		CreatedAt int64  `json:"created_at"`
		UpdatedAt int64  `json:"updated_at"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}
	req.Id = strings.TrimSpace(req.Id)
	if req.Id == "" || len(req.Id) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid session id"})
		return
	}
	if len(req.Messages) > maxPlaygroundSessionBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "conversation too large to sync"})
		return
	}
	now := time.Now().UnixMilli()
	if req.CreatedAt <= 0 {
		req.CreatedAt = now
	}
	if req.UpdatedAt <= 0 {
		req.UpdatedAt = now
	}
	if len(req.Title) > 200 {
		req.Title = req.Title[:200]
	}
	session := &model.PlaygroundSession{
		Id:        req.Id,
		UserId:    c.GetInt("id"),
		Title:     req.Title,
		Messages:  req.Messages,
		CreatedAt: req.CreatedAt,
		UpdatedAt: req.UpdatedAt,
	}
	if err := model.UpsertPlaygroundSession(session); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeletePlaygroundSession removes one conversation (scoped to the caller).
func DeletePlaygroundSession(c *gin.Context) {
	id := strings.TrimSpace(c.Param("session_id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid session id"})
		return
	}
	if err := model.DeletePlaygroundSession(c.GetInt("id"), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
