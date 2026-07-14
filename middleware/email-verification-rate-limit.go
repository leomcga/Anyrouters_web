package middleware

import (
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

const (
	EmailVerificationRateLimitMark = "EV"
	EmailVerificationMaxRequests   = 2  // 30秒内最多2次
	EmailVerificationDuration      = 30 // 30秒时间窗口
)

func redisEmailVerificationRateLimiter(c *gin.Context) {
	key := "emailVerification:" + EmailVerificationRateLimitMark + ":" + common.GenerateHMAC(c.ClientIP())
	allowed, retryAfter, err := common.RedisFixedWindowAllow(
		c.Request.Context(),
		key,
		1,
		EmailVerificationMaxRequests,
		time.Duration(EmailVerificationDuration)*time.Second,
	)
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		c.Abort()
		return
	}
	if allowed {
		c.Next()
		return
	}
	if retryAfter < 1 {
		retryAfter = EmailVerificationDuration
	}

	c.JSON(http.StatusTooManyRequests, gin.H{
		"success": false,
		"message": fmt.Sprintf("发送过于频繁，请等待 %d 秒后再试", retryAfter),
	})
	c.Abort()
}

func memoryEmailVerificationRateLimiter(c *gin.Context) {
	key := EmailVerificationRateLimitMark + ":" + c.ClientIP()

	if !inMemoryRateLimiter.Request(key, EmailVerificationMaxRequests, EmailVerificationDuration) {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"message": "发送过于频繁，请稍后再试",
		})
		c.Abort()
		return
	}

	c.Next()
}

func EmailVerificationRateLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if common.RedisReady() {
			redisEmailVerificationRateLimiter(c)
		} else if common.RedisEnabled {
			c.Status(http.StatusServiceUnavailable)
			c.Abort()
		} else {
			inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
			memoryEmailVerificationRateLimiter(c)
		}
	}
}
