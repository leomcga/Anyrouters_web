package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// Ticket status lifecycle:
//   open    — waiting for staff (user just created it or replied after a staff reply)
//   replied — staff answered, waiting on the user
//   closed  — resolved / closed by staff or user
const (
	TicketStatusOpen    = "open"
	TicketStatusReplied = "replied"
	TicketStatusClosed  = "closed"
)

// Ticket is one support conversation, owned by the user who opened it. The
// native in-app help desk: the user is already authenticated, so their
// identity (id / display name / group) is attached automatically — no second
// login, no "please tell us your account number".
type Ticket struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"index"`
	Title     string `json:"title" gorm:"size:200"`
	Status    string `json:"status" gorm:"size:16;index"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;index"`
	// Unread flags per side, so both the user and staff see a badge for a reply
	// they haven't opened yet.
	UserUnread  bool `json:"user_unread" gorm:"default:false"`
	AdminUnread bool `json:"admin_unread" gorm:"default:false"`
	// Denormalized author identity for the admin list (avoids an N+1 join).
	UserName string `json:"user_name" gorm:"-"`
	UserCode string `json:"user_code" gorm:"-"`

	Messages []TicketMessage `json:"messages,omitempty" gorm:"-"`
}

// TicketMessage is one message in a ticket thread. Content is text/markdown and
// may embed base64 data-image URLs (screenshots) — capped at the controller.
type TicketMessage struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	TicketId   int    `json:"ticket_id" gorm:"index"`
	AuthorRole string `json:"author_role" gorm:"size:16"` // "user" | "admin"
	AuthorId   int    `json:"author_id"`
	AuthorName string `json:"author_name" gorm:"size:64"`
	Content    string `json:"content"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
}

// CreateTicket opens a new ticket with its first (user) message, atomically.
func CreateTicket(userId int, userName, title, content string) (*Ticket, error) {
	now := common.GetTimestamp()
	ticket := &Ticket{
		UserId:      userId,
		Title:       title,
		Status:      TicketStatusOpen,
		CreatedAt:   now,
		UpdatedAt:   now,
		AdminUnread: true, // staff hasn't seen it yet
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Create(ticket).Error; e != nil {
			return e
		}
		msg := &TicketMessage{
			TicketId:   ticket.Id,
			AuthorRole: "user",
			AuthorId:   userId,
			AuthorName: userName,
			Content:    content,
			CreatedAt:  now,
		}
		return tx.Create(msg).Error
	})
	if err != nil {
		return nil, err
	}
	return ticket, nil
}

func GetUserTickets(userId int) ([]*Ticket, error) {
	var tickets []*Ticket
	err := DB.Where("user_id = ?", userId).
		Order("updated_at desc").
		Find(&tickets).Error
	return tickets, err
}

// GetAllTicketsForAdmin returns tickets (optionally filtered by status), newest
// activity first, with each opener's identity resolved for the admin list.
func GetAllTicketsForAdmin(status string, offset, limit int) ([]*Ticket, int64, error) {
	q := DB.Model(&Ticket{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	if e := q.Count(&total).Error; e != nil {
		return nil, 0, e
	}
	var tickets []*Ticket
	if e := q.Order("updated_at desc").Offset(offset).Limit(limit).Find(&tickets).Error; e != nil {
		return nil, 0, e
	}
	// Attach opener identity (id / display name) in one extra query.
	if len(tickets) > 0 {
		ids := make([]int, 0, len(tickets))
		for _, t := range tickets {
			ids = append(ids, t.UserId)
		}
		type urow struct {
			Id          int
			Username    string
			DisplayName string
		}
		var rows []urow
		DB.Model(&User{}).Select("id", "username", "display_name").Where("id IN ?", ids).Find(&rows)
		byId := map[int]urow{}
		for _, r := range rows {
			byId[r.Id] = r
		}
		for _, t := range tickets {
			if r, ok := byId[t.UserId]; ok {
				t.UserName = firstNonEmpty(r.DisplayName, r.Username)
			}
			t.UserCode = fmt.Sprintf("AR%06d", t.UserId)
		}
	}
	return tickets, total, nil
}

// GetTicketWithMessages loads one ticket plus its thread. When enforceUserId is
// non-zero, the ticket must belong to that user (self access); pass 0 for admin.
func GetTicketWithMessages(id, enforceUserId int) (*Ticket, error) {
	ticket := &Ticket{}
	if e := DB.First(ticket, id).Error; e != nil {
		return nil, errors.New("工单不存在")
	}
	if enforceUserId != 0 && ticket.UserId != enforceUserId {
		return nil, errors.New("无权访问该工单")
	}
	var msgs []TicketMessage
	DB.Where("ticket_id = ?", id).Order("created_at asc").Find(&msgs)
	ticket.Messages = msgs
	ticket.UserCode = fmt.Sprintf("AR%06d", ticket.UserId)
	return ticket, nil
}

// AddTicketMessage appends a reply and moves the ticket's state: a user reply
// re-opens it for staff (admin_unread), a staff reply flags the user
// (user_unread) and marks it "replied". A closed ticket reopens on a new
// message. Runs in one transaction.
func AddTicketMessage(ticketId, enforceUserId int, role string, authorId int, authorName, content string) (*Ticket, error) {
	now := common.GetTimestamp()
	ticket := &Ticket{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.First(ticket, ticketId).Error; e != nil {
			return errors.New("工单不存在")
		}
		if enforceUserId != 0 && ticket.UserId != enforceUserId {
			return errors.New("无权访问该工单")
		}
		msg := &TicketMessage{
			TicketId:   ticketId,
			AuthorRole: role,
			AuthorId:   authorId,
			AuthorName: authorName,
			Content:    content,
			CreatedAt:  now,
		}
		if e := tx.Create(msg).Error; e != nil {
			return e
		}
		updates := map[string]interface{}{"updated_at": now}
		if role == "user" {
			updates["status"] = TicketStatusOpen
			updates["admin_unread"] = true
		} else {
			updates["status"] = TicketStatusReplied
			updates["user_unread"] = true
		}
		return tx.Model(&Ticket{}).Where("id = ?", ticketId).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	return GetTicketWithMessages(ticketId, enforceUserId)
}

// SetTicketStatus lets staff (or the owning user) close/reopen a ticket.
func SetTicketStatus(id, enforceUserId int, status string) error {
	if status != TicketStatusOpen && status != TicketStatusReplied && status != TicketStatusClosed {
		return errors.New("非法状态")
	}
	q := DB.Model(&Ticket{}).Where("id = ?", id)
	if enforceUserId != 0 {
		q = q.Where("user_id = ?", enforceUserId)
	}
	return q.Updates(map[string]interface{}{"status": status, "updated_at": common.GetTimestamp()}).Error
}

// MarkTicketRead clears the unread flag for the side that just opened it.
func MarkTicketRead(id, enforceUserId int, role string) error {
	q := DB.Model(&Ticket{}).Where("id = ?", id)
	if enforceUserId != 0 {
		q = q.Where("user_id = ?", enforceUserId)
	}
	col := "admin_unread"
	if role == "user" {
		col = "user_unread"
	}
	return q.Update(col, false).Error
}

// CountAdminUnreadTickets / CountUserUnreadTickets drive the sidebar badge.
func CountAdminUnreadTickets() int64 {
	var n int64
	DB.Model(&Ticket{}).Where("admin_unread = ?", true).Count(&n)
	return n
}

func CountUserUnreadTickets(userId int) int64 {
	var n int64
	DB.Model(&Ticket{}).Where("user_id = ? AND user_unread = ?", userId, true).Count(&n)
	return n
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
