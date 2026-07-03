package model

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PlaygroundSession is a cloud-persisted playground conversation, so history
// survives refreshes, device switches and local-storage loss. The id is the
// client-generated session UUID; every query is additionally scoped by user_id
// so one user can never read or overwrite another's conversation.
//
// Messages holds the client's message-array JSON verbatim. Generated images
// are stripped to lightweight idbimg:// refs client-side before upload (the
// pictures themselves stay on the generating device), so rows stay small.
// The unsized string maps to LONGTEXT on MySQL and TEXT on PG/SQLite.
type PlaygroundSession struct {
	Id        string `json:"id" gorm:"primaryKey;size:64"`
	UserId    int    `json:"user_id" gorm:"index"`
	Title     string `json:"title" gorm:"size:255"`
	Messages  string `json:"messages"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint"`
}

// Keep in sync with the frontend cap (sessions.ts MAX_SESSIONS); the server
// prunes anything older so a runaway client cannot grow the table unbounded.
const maxPlaygroundSessionsPerUser = 50

func GetPlaygroundSessions(userId int) ([]*PlaygroundSession, error) {
	var sessions []*PlaygroundSession
	err := DB.Where("user_id = ?", userId).
		Order("updated_at desc").
		Limit(maxPlaygroundSessionsPerUser).
		Find(&sessions).Error
	return sessions, err
}

// UpsertPlaygroundSession inserts or updates one conversation. Ownership is
// enforced: if the id already exists under another user the write is rejected.
func UpsertPlaygroundSession(session *PlaygroundSession) error {
	var existing PlaygroundSession
	err := DB.Select("user_id").Where("id = ?", session.Id).First(&existing).Error
	if err == nil && existing.UserId != session.UserId {
		return fmt.Errorf("session id already in use")
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err := DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"title", "messages", "updated_at",
		}),
	}).Create(session).Error; err != nil {
		return err
	}
	go prunePlaygroundSessions(session.UserId)
	return nil
}

func DeletePlaygroundSession(userId int, id string) error {
	return DB.Where("id = ? AND user_id = ?", id, userId).
		Delete(&PlaygroundSession{}).Error
}

// prunePlaygroundSessions drops a user's sessions beyond the newest cap. Runs
// async after upserts; failures only log-worthy, never user-facing.
func prunePlaygroundSessions(userId int) {
	var ids []string
	if err := DB.Model(&PlaygroundSession{}).
		Where("user_id = ?", userId).
		Order("updated_at desc").
		Offset(maxPlaygroundSessionsPerUser).
		Limit(200).
		Pluck("id", &ids).Error; err != nil || len(ids) == 0 {
		return
	}
	DB.Where("user_id = ? AND id IN ?", userId, ids).Delete(&PlaygroundSession{})
}
