package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPlaygroundSessionPersistsControlledGPT55LongAnswerExactly(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:playground-stream?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&PlaygroundSession{}))

	text := strings.Repeat("产品定位、渠道匹配和持续复购必须形成闭环。", 512)
	messages, err := json.Marshal([]map[string]any{{
		"key":               "assistant-1",
		"from":              "assistant",
		"versions":          []map[string]string{{"id": "v1", "content": text}},
		"status":            "complete",
		"finishReason":      "stop",
		"terminationReason": "stop",
		"requestId":         "req-controlled-gpt55",
	}})
	require.NoError(t, err)

	session := PlaygroundSession{
		Id:       "controlled-gpt55",
		UserId:   1,
		Title:    "controlled stream",
		Messages: string(messages),
	}
	require.NoError(t, db.Create(&session).Error)

	var stored PlaygroundSession
	require.NoError(t, db.First(&stored, "id = ?", session.Id).Error)
	var restored []struct {
		Versions []struct {
			Content string `json:"content"`
		} `json:"versions"`
	}
	require.NoError(t, json.Unmarshal([]byte(stored.Messages), &restored))
	require.Equal(t, text, restored[0].Versions[0].Content)
	require.Equal(t, 32256, len(restored[0].Versions[0].Content))
}
