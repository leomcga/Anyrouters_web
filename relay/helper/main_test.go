package helper

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
)

func TestMain(m *testing.M) {
	oldMode := gin.Mode()
	oldStreamingTimeout := constant.StreamingTimeout

	gin.SetMode(gin.TestMode)
	constant.StreamingTimeout = 30

	code := m.Run()

	constant.StreamingTimeout = oldStreamingTimeout
	gin.SetMode(oldMode)
	os.Exit(code)
}
