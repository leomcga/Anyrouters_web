package common

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/constant"
)

var (
	Port         = flag.Int("port", 3000, "the listening port")
	PrintVersion = flag.Bool("version", false, "print version and exit")
	PrintHelp    = flag.Bool("help", false, "print help and exit")
	LogDir       = flag.String("log-dir", "./logs", "specify the log directory")
)

func printHelp() {
	fmt.Println("NewAPI(Based OneAPI) " + Version + " - The next-generation LLM gateway and AI asset management system supports multiple languages.")
	fmt.Println("Original Project: OneAPI by JustSong - https://github.com/songquanpeng/one-api")
	fmt.Println("Maintainer: QuantumNous - https://github.com/QuantumNous/new-api")
	fmt.Println("Usage: newapi [--port <port>] [--log-dir <log directory>] [--version] [--help]")
}

func InitEnv() {
	flag.Parse()

	envVersion := os.Getenv("VERSION")
	if envVersion != "" {
		Version = envVersion
	}

	if *PrintVersion {
		fmt.Println(Version)
		os.Exit(0)
	}

	if *PrintHelp {
		printHelp()
		os.Exit(0)
	}

	if os.Getenv("SESSION_SECRET") != "" {
		ss := os.Getenv("SESSION_SECRET")
		if ss == "random_string" {
			log.Println("WARNING: SESSION_SECRET is set to the default value 'random_string', please change it to a random string.")
			log.Println("警告：SESSION_SECRET被设置为默认值'random_string'，请修改为随机字符串。")
			log.Fatal("Please set SESSION_SECRET to a random string.")
		} else {
			SessionSecret = ss
		}
	}
	if os.Getenv("CRYPTO_SECRET") != "" {
		CryptoSecret = os.Getenv("CRYPTO_SECRET")
	} else {
		CryptoSecret = SessionSecret
	}
	APIKeyPepper = strings.TrimSpace(os.Getenv("API_KEY_PEPPER"))
	APIKeyLegacyAuthEnabled = GetEnvOrDefaultBool("API_KEY_LEGACY_AUTH_ENABLED", true)
	if os.Getenv("SQLITE_PATH") != "" {
		SQLitePath = os.Getenv("SQLITE_PATH")
	}
	if *LogDir != "" {
		var err error
		*LogDir, err = filepath.Abs(*LogDir)
		if err != nil {
			log.Fatal(err)
		}
		if _, err := os.Stat(*LogDir); os.IsNotExist(err) {
			err = os.Mkdir(*LogDir, 0777)
			if err != nil {
				log.Fatal(err)
			}
		}
	}

	// Initialize variables from constants.go that were using environment variables
	var debugBlocked bool
	DebugEnabled, debugBlocked = resolveDebugMode(os.Getenv("APP_ENV"), os.Getenv("DEBUG"))
	if debugBlocked {
		SysError("DEBUG was requested but has been disabled because APP_ENV is production")
	}
	MemoryCacheEnabled = os.Getenv("MEMORY_CACHE_ENABLED") == "true"
	IsMasterNode = os.Getenv("NODE_TYPE") != "slave"
	NodeName = os.Getenv("NODE_NAME")
	TLSInsecureSkipVerify = GetEnvOrDefaultBool("TLS_INSECURE_SKIP_VERIFY", false)
	if TLSInsecureSkipVerify {
		if tr, ok := http.DefaultTransport.(*http.Transport); ok && tr != nil {
			if tr.TLSClientConfig != nil {
				tr.TLSClientConfig.InsecureSkipVerify = true
			} else {
				tr.TLSClientConfig = InsecureTLSConfig
			}
		}
	}

	// Parse requestInterval and set RequestInterval
	requestInterval, _ = strconv.Atoi(os.Getenv("POLLING_INTERVAL"))
	RequestInterval = time.Duration(requestInterval) * time.Second

	// Initialize variables with GetEnvOrDefault
	SyncFrequency = GetEnvOrDefault("SYNC_FREQUENCY", 60)
	BatchUpdateInterval = GetEnvOrDefault("BATCH_UPDATE_INTERVAL", 5)
	RelayTimeout = GetEnvOrDefault("RELAY_TIMEOUT", 0)
	RelayIdleConnTimeout = GetEnvOrDefault("RELAY_IDLE_CONN_TIMEOUT", 90)
	RelayMaxIdleConns = GetEnvOrDefault("RELAY_MAX_IDLE_CONNS", 500)
	RelayMaxIdleConnsPerHost = GetEnvOrDefault("RELAY_MAX_IDLE_CONNS_PER_HOST", 100)
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	isProduction := environment == "production" || environment == "prod"
	OutboundAllowHTTP = GetEnvOrDefaultBool("OUTBOUND_ALLOW_HTTP", !isProduction)
	OutboundMaxRedirects = GetEnvOrDefault("OUTBOUND_MAX_REDIRECTS", 3)
	OutboundMaxRequestBodyBytes = int64(GetEnvOrDefault("OUTBOUND_MAX_REQUEST_BYTES", 64<<20))
	OutboundMaxResponseBodyBytes = int64(GetEnvOrDefault("OUTBOUND_MAX_RESPONSE_BYTES", 128<<20))
	OutboundConnectTimeoutSeconds = GetEnvOrDefault("OUTBOUND_CONNECT_TIMEOUT_SECONDS", 10)
	OutboundTLSHandshakeTimeoutSeconds = GetEnvOrDefault("OUTBOUND_TLS_HANDSHAKE_TIMEOUT_SECONDS", 10)
	OutboundResponseHeaderTimeoutSeconds = GetEnvOrDefault("OUTBOUND_RESPONSE_HEADER_TIMEOUT_SECONDS", 30)
	OutboundRequestTimeoutSeconds = GetEnvOrDefault("OUTBOUND_REQUEST_TIMEOUT_SECONDS", 600)
	OutboundTrustedDomains = splitTrimmedEnvList(os.Getenv("OUTBOUND_TRUSTED_DOMAINS"))
	OutboundTrustedProxyURLs = splitTrimmedEnvList(os.Getenv("OUTBOUND_TRUSTED_PROXY_URLS"))

	// Initialize string variables with GetEnvOrDefaultString
	GeminiSafetySetting = GetEnvOrDefaultString("GEMINI_SAFETY_SETTING", "BLOCK_NONE")
	CohereSafetySetting = GetEnvOrDefaultString("COHERE_SAFETY_SETTING", "NONE")

	// Initialize rate limit variables
	GlobalApiRateLimitEnable = GetEnvOrDefaultBool("GLOBAL_API_RATE_LIMIT_ENABLE", true)
	GlobalApiRateLimitNum = GetEnvOrDefault("GLOBAL_API_RATE_LIMIT", 360)
	GlobalApiRateLimitDuration = int64(GetEnvOrDefault("GLOBAL_API_RATE_LIMIT_DURATION", 180))

	GlobalWebRateLimitEnable = GetEnvOrDefaultBool("GLOBAL_WEB_RATE_LIMIT_ENABLE", true)
	GlobalWebRateLimitNum = GetEnvOrDefault("GLOBAL_WEB_RATE_LIMIT", 120)
	GlobalWebRateLimitDuration = int64(GetEnvOrDefault("GLOBAL_WEB_RATE_LIMIT_DURATION", 180))

	CriticalRateLimitEnable = GetEnvOrDefaultBool("CRITICAL_RATE_LIMIT_ENABLE", true)
	CriticalRateLimitNum = GetEnvOrDefault("CRITICAL_RATE_LIMIT", 20)
	CriticalRateLimitDuration = int64(GetEnvOrDefault("CRITICAL_RATE_LIMIT_DURATION", 20*60))

	SearchRateLimitEnable = GetEnvOrDefaultBool("SEARCH_RATE_LIMIT_ENABLE", true)
	SearchRateLimitNum = GetEnvOrDefault("SEARCH_RATE_LIMIT", 10)
	SearchRateLimitDuration = int64(GetEnvOrDefault("SEARCH_RATE_LIMIT_DURATION", 60))
	TrafficControlEnabled = GetEnvOrDefaultBool("TRAFFIC_CONTROL_ENABLED", true)
	TrafficUserRPMLimit = int64(GetEnvOrDefault("TRAFFIC_USER_RPM", 600))
	TrafficKeyRPMLimit = int64(GetEnvOrDefault("TRAFFIC_KEY_RPM", 300))
	TrafficIPRPMLimit = int64(GetEnvOrDefault("TRAFFIC_IP_RPM", 300))
	TrafficModelRPMLimit = int64(GetEnvOrDefault("TRAFFIC_MODEL_RPM", 3000))
	TrafficChannelRPMLimit = int64(GetEnvOrDefault("TRAFFIC_CHANNEL_RPM", 3000))
	TrafficUserTPMLimit = int64(GetEnvOrDefault("TRAFFIC_USER_TPM", 2_000_000))
	TrafficKeyTPMLimit = int64(GetEnvOrDefault("TRAFFIC_KEY_TPM", 1_000_000))
	TrafficIPTPMLimit = int64(GetEnvOrDefault("TRAFFIC_IP_TPM", 1_000_000))
	TrafficModelTPMLimit = int64(GetEnvOrDefault("TRAFFIC_MODEL_TPM", 10_000_000))
	TrafficChannelTPMLimit = int64(GetEnvOrDefault("TRAFFIC_CHANNEL_TPM", 10_000_000))
	TrafficUserMaxConcurrent = int64(GetEnvOrDefault("TRAFFIC_USER_MAX_CONCURRENT", 50))
	TrafficKeyMaxConcurrent = int64(GetEnvOrDefault("TRAFFIC_KEY_MAX_CONCURRENT", 20))
	TrafficIPMaxConcurrent = int64(GetEnvOrDefault("TRAFFIC_IP_MAX_CONCURRENT", 30))
	TrafficModelMaxConcurrent = int64(GetEnvOrDefault("TRAFFIC_MODEL_MAX_CONCURRENT", 200))
	TrafficChannelMaxConcurrent = int64(GetEnvOrDefault("TRAFFIC_CHANNEL_MAX_CONCURRENT", 200))
	TrafficUserDailyTokenLimit = int64(GetEnvOrDefault("TRAFFIC_USER_DAILY_TOKENS", 1_000_000_000))
	TrafficKeyDailyTokenLimit = int64(GetEnvOrDefault("TRAFFIC_KEY_DAILY_TOKENS", 500_000_000))
	TrafficUserDailyQuotaLimit = int64(GetEnvOrDefault("TRAFFIC_USER_DAILY_QUOTA", 1_000_000_000))
	TrafficDefaultOutputTokens = int64(GetEnvOrDefault("TRAFFIC_DEFAULT_OUTPUT_TOKENS", 8192))
	ChannelCircuitFailureThreshold = int64(GetEnvOrDefault("CHANNEL_CIRCUIT_FAILURE_THRESHOLD", 5))
	ChannelCircuitOpenSeconds = int64(GetEnvOrDefault("CHANNEL_CIRCUIT_OPEN_SECONDS", 60))
	ChannelCircuitHalfOpenProbes = int64(GetEnvOrDefault("CHANNEL_CIRCUIT_HALF_OPEN_PROBES", 1))
	initConstantEnv()
}

func splitTrimmedEnvList(value string) []string {
	items := strings.Split(value, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func ValidateAPIKeySecurityConfig() error {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if (environment == "production" || environment == "prod") && APIKeyPepper == "" {
		return errors.New("production requires API_KEY_PEPPER")
	}
	return nil
}

func ValidateWebSecurityConfig() error {
	if !IsProduction() {
		return nil
	}
	if len(strings.TrimSpace(os.Getenv("SESSION_SECRET"))) < 32 {
		return errors.New("production requires SESSION_SECRET with at least 32 characters")
	}
	if _, err := ParseExactOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")); err != nil {
		return fmt.Errorf("invalid CORS_ALLOWED_ORIGINS: %w", err)
	}
	if constant.DifyDebug {
		return errors.New("production requires DIFY_DEBUG=false")
	}
	if GetEnvOrDefaultBool("ENABLE_PPROF", false) {
		return errors.New("production requires ENABLE_PPROF=false")
	}
	return nil
}

func ValidateTrafficControlConfig() error {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if environment != "production" && environment != "prod" {
		return nil
	}
	if !TrafficControlEnabled {
		return errors.New("production requires TRAFFIC_CONTROL_ENABLED=true")
	}
	values := map[string]int64{
		"TRAFFIC_USER_RPM":                  TrafficUserRPMLimit,
		"TRAFFIC_KEY_RPM":                   TrafficKeyRPMLimit,
		"TRAFFIC_IP_RPM":                    TrafficIPRPMLimit,
		"TRAFFIC_MODEL_RPM":                 TrafficModelRPMLimit,
		"TRAFFIC_CHANNEL_RPM":               TrafficChannelRPMLimit,
		"TRAFFIC_USER_TPM":                  TrafficUserTPMLimit,
		"TRAFFIC_KEY_TPM":                   TrafficKeyTPMLimit,
		"TRAFFIC_IP_TPM":                    TrafficIPTPMLimit,
		"TRAFFIC_MODEL_TPM":                 TrafficModelTPMLimit,
		"TRAFFIC_CHANNEL_TPM":               TrafficChannelTPMLimit,
		"TRAFFIC_USER_MAX_CONCURRENT":       TrafficUserMaxConcurrent,
		"TRAFFIC_KEY_MAX_CONCURRENT":        TrafficKeyMaxConcurrent,
		"TRAFFIC_IP_MAX_CONCURRENT":         TrafficIPMaxConcurrent,
		"TRAFFIC_MODEL_MAX_CONCURRENT":      TrafficModelMaxConcurrent,
		"TRAFFIC_CHANNEL_MAX_CONCURRENT":    TrafficChannelMaxConcurrent,
		"TRAFFIC_USER_DAILY_TOKENS":         TrafficUserDailyTokenLimit,
		"TRAFFIC_KEY_DAILY_TOKENS":          TrafficKeyDailyTokenLimit,
		"TRAFFIC_USER_DAILY_QUOTA":          TrafficUserDailyQuotaLimit,
		"TRAFFIC_DEFAULT_OUTPUT_TOKENS":     TrafficDefaultOutputTokens,
		"CHANNEL_CIRCUIT_FAILURE_THRESHOLD": ChannelCircuitFailureThreshold,
		"CHANNEL_CIRCUIT_OPEN_SECONDS":      ChannelCircuitOpenSeconds,
		"CHANNEL_CIRCUIT_HALF_OPEN_PROBES":  ChannelCircuitHalfOpenProbes,
	}
	for name, value := range values {
		if value <= 0 {
			return fmt.Errorf("production requires %s to be a positive integer", name)
		}
	}
	return nil
}

func resolveDebugMode(appEnv string, debugValue string) (enabled bool, blocked bool) {
	debugRequested := strings.EqualFold(strings.TrimSpace(debugValue), "true")
	environment := strings.ToLower(strings.TrimSpace(appEnv))
	isProduction := environment == "production" || environment == "prod"
	if isProduction && debugRequested {
		return false, true
	}
	return debugRequested, false
}

func initConstantEnv() {
	constant.StreamingTimeout = GetEnvOrDefault("STREAMING_TIMEOUT", 300)
	constant.DifyDebug = GetEnvOrDefaultBool("DIFY_DEBUG", !IsProduction())
	constant.MaxFileDownloadMB = GetEnvOrDefault("MAX_FILE_DOWNLOAD_MB", 64)
	constant.StreamScannerMaxBufferMB = GetEnvOrDefault("STREAM_SCANNER_MAX_BUFFER_MB", 128)
	// MaxRequestBodyMB 请求体最大大小（解压后），用于防止超大请求/zip bomb导致内存暴涨
	constant.MaxRequestBodyMB = GetEnvOrDefault("MAX_REQUEST_BODY_MB", 128)
	constant.AnonymousRequestBodyLimitKB = GetEnvOrDefault("ANONYMOUS_REQUEST_BODY_LIMIT_KB", 512)
	// ForceStreamOption 覆盖请求参数，强制返回usage信息
	constant.ForceStreamOption = GetEnvOrDefaultBool("FORCE_STREAM_OPTION", true)
	constant.CountToken = GetEnvOrDefaultBool("CountToken", true)
	constant.GetMediaToken = GetEnvOrDefaultBool("GET_MEDIA_TOKEN", true)
	constant.GetMediaTokenNotStream = GetEnvOrDefaultBool("GET_MEDIA_TOKEN_NOT_STREAM", false)
	constant.UpdateTask = GetEnvOrDefaultBool("UPDATE_TASK", true)
	constant.AzureDefaultAPIVersion = GetEnvOrDefaultString("AZURE_DEFAULT_API_VERSION", "2025-04-01-preview")
	constant.NotifyLimitCount = GetEnvOrDefault("NOTIFY_LIMIT_COUNT", 2)
	constant.NotificationLimitDurationMinute = GetEnvOrDefault("NOTIFICATION_LIMIT_DURATION_MINUTE", 10)
	// GenerateDefaultToken 是否生成初始令牌，默认关闭。
	constant.GenerateDefaultToken = GetEnvOrDefaultBool("GENERATE_DEFAULT_TOKEN", false)
	// 是否启用错误日志
	constant.ErrorLogEnabled = GetEnvOrDefaultBool("ERROR_LOG_ENABLED", false)
	// 任务轮询时查询的最大数量
	constant.TaskQueryLimit = GetEnvOrDefault("TASK_QUERY_LIMIT", 1000)
	// 异步任务超时时间（分钟），超过此时间未完成的任务将被标记为失败并退款。0 表示禁用。
	constant.TaskTimeoutMinutes = GetEnvOrDefault("TASK_TIMEOUT_MINUTES", 1440)

	soraPatchStr := GetEnvOrDefaultString("TASK_PRICE_PATCH", "")
	if soraPatchStr != "" {
		var taskPricePatches []string
		soraPatches := strings.Split(soraPatchStr, ",")
		for _, patch := range soraPatches {
			trimmedPatch := strings.TrimSpace(patch)
			if trimmedPatch != "" {
				taskPricePatches = append(taskPricePatches, trimmedPatch)
			}
		}
		constant.TaskPricePatches = taskPricePatches
	}

	// Initialize trusted redirect domains for URL validation
	trustedDomainsStr := GetEnvOrDefaultString("TRUSTED_REDIRECT_DOMAINS", "")
	var trustedDomains []string
	domains := strings.Split(trustedDomainsStr, ",")
	for _, domain := range domains {
		trimmedDomain := strings.TrimSpace(domain)
		if trimmedDomain != "" {
			// Normalize domain to lowercase
			trustedDomains = append(trustedDomains, strings.ToLower(trimmedDomain))
		}
	}
	constant.TrustedRedirectDomains = trustedDomains
}
