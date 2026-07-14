package gemini

import (
	"os"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMain(m *testing.M) {
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)

	code := m.Run()

	gin.SetMode(oldMode)
	os.Exit(code)
}
