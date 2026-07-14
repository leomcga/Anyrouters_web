package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type memorySession struct {
	values  map[any]any
	options sessions.Options
	saved   bool
}

func TestLogoutExpiresSessionCookie(t *testing.T) {
	store := cookie.NewStore([]byte(strings.Repeat("s", 32)))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   3600,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	engine := gin.New()
	engine.Use(sessions.Sessions("session", store))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 42)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/logout", Logout)

	seed := httptest.NewRecorder()
	engine.ServeHTTP(seed, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.NotEmpty(t, seed.Result().Cookies())

	request := httptest.NewRequest(http.MethodGet, "/logout", nil)
	for _, value := range seed.Result().Cookies() {
		request.AddCookie(value)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	cookies := recorder.Result().Cookies()
	require.NotEmpty(t, cookies)
	require.Equal(t, -1, cookies[0].MaxAge)
}

func (s *memorySession) ID() string                         { return "" }
func (s *memorySession) Get(key any) any                    { return s.values[key] }
func (s *memorySession) Set(key any, value any)             { s.values[key] = value }
func (s *memorySession) Delete(key any)                     { delete(s.values, key) }
func (s *memorySession) Clear()                             { s.values = make(map[any]any) }
func (s *memorySession) AddFlash(value any, vars ...string) {}
func (s *memorySession) Flashes(vars ...string) []any       { return nil }
func (s *memorySession) Options(options sessions.Options)   { s.options = options }
func (s *memorySession) Save() error                        { s.saved = true; return nil }

func TestWriteAuthenticatedSessionClearsFixedSessionState(t *testing.T) {
	session := &memorySession{values: map[any]any{
		"attacker_controlled": "fixed",
		"oauth_state":         "old",
	}}
	user := &model.User{Id: 42, Username: "alice", Role: 1, Status: 1, Group: "default"}
	require.NoError(t, writeAuthenticatedSession(session, user))
	require.Nil(t, session.Get("attacker_controlled"))
	require.Nil(t, session.Get("oauth_state"))
	require.Equal(t, 42, session.Get("id"))
	require.Equal(t, "alice", session.Get("username"))
	require.True(t, session.saved)
}
