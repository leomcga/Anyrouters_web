package middleware

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func RelayPanicRecover() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				common.SysError(fmt.Sprintf(
					"relay panic recovered request_id=%s",
					c.GetString(common.RequestIdKey),
				))
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": gin.H{
						"message": "Internal server error",
						"type":    "internal_error",
					},
				})
				c.Abort()
			}
		}()
		c.Next()
	}
}
