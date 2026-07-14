package model

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

type Token struct {
	Id                 int            `json:"id"`
	UserId             int            `json:"user_id" gorm:"index"`
	Key                string         `json:"-" gorm:"column:key;type:varchar(128);uniqueIndex"`
	PublicId           string         `json:"public_id" gorm:"column:public_id;type:varchar(32);not null;default:''"`
	KeyPrefix          string         `json:"key_prefix" gorm:"column:key_prefix;type:varchar(32);not null;default:''"`
	KeyHash            string         `json:"-" gorm:"column:key_hash;type:char(64);not null;default:''"`
	LegacyLookupHash   string         `json:"-" gorm:"column:legacy_lookup_hash;type:char(64);not null;default:''"`
	LastFour           string         `json:"last_four" gorm:"column:last_four;type:varchar(4);not null;default:''"`
	KeyVersion         int            `json:"key_version" gorm:"column:key_version;not null;default:0;index"`
	Scopes             string         `json:"scopes" gorm:"type:varchar(256);not null;default:''"`
	RevokedAt          int64          `json:"revoked_at" gorm:"bigint;not null;default:0;index"`
	MigratedAt         int64          `json:"migrated_at" gorm:"bigint;not null;default:0"`
	Status             int            `json:"status" gorm:"default:1"`
	Name               string         `json:"name" gorm:"index" `
	CreatedTime        int64          `json:"created_time" gorm:"bigint"`
	AccessedTime       int64          `json:"accessed_time" gorm:"bigint"`
	ExpiredTime        int64          `json:"expired_time" gorm:"bigint;default:-1"` // -1 means never expired
	RemainQuota        int            `json:"remain_quota" gorm:"default:0"`
	UnlimitedQuota     bool           `json:"unlimited_quota"`
	ModelLimitsEnabled bool           `json:"model_limits_enabled"`
	ModelLimits        string         `json:"model_limits" gorm:"type:text"`
	AllowIps           *string        `json:"allow_ips" gorm:"default:''"`
	UsedQuota          int            `json:"used_quota" gorm:"default:0"` // used quota
	Group              string         `json:"group" gorm:"default:''"`
	CrossGroupRetry    bool           `json:"cross_group_retry"` // 跨分组重试，仅auto分组有效
	DeletedAt          gorm.DeletedAt `gorm:"index"`
}

func (token *Token) Clean() {
	token.Key = ""
	token.KeyHash = ""
	token.LegacyLookupHash = ""
}

func MaskTokenKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	if len(key) <= 8 {
		return key[:2] + "****" + key[len(key)-2:]
	}
	return key[:4] + "**********" + key[len(key)-4:]
}

func (token *Token) GetFullKey() string {
	return ""
}

func (token *Token) GetMaskedKey() string {
	if token.KeyPrefix == "" && token.LastFour == "" {
		return ""
	}
	return token.KeyPrefix + "..." + token.LastFour
}

const (
	apiKeyPrefix             = "ak_"
	apiKeyPublicIDLength     = 16
	apiKeySecretLength       = 40
	apiKeyVersionHashed      = 1
	defaultAPIKeyScopes      = "api,usage"
	maxAPIKeyNameLength      = 50
	maxAPIKeyScopesLength    = 256
	maxAPIKeyModelListLength = 8192
	maxAPIKeyIPListLength    = 4096
)

var (
	ErrAPIKeyPepperMissing = errors.New("API key security configuration is unavailable")
	ErrAPIKeyInvalid       = errors.New("invalid API key")
	ErrAPIKeyConflict      = errors.New("API key state conflict")
)

func apiKeyHMAC(value string) (string, error) {
	if common.APIKeyPepper == "" {
		return "", ErrAPIKeyPepperMissing
	}
	mac := hmac.New(sha256.New, []byte(common.APIKeyPepper))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func constantTimeHashEqual(actual string, expected string) bool {
	actualBytes, actualErr := hex.DecodeString(actual)
	expectedBytes, expectedErr := hex.DecodeString(expected)
	if actualErr != nil || expectedErr != nil {
		return false
	}
	return hmac.Equal(actualBytes, expectedBytes)
}

func parseHashedAPIKey(raw string) (publicID string, secret string, ok bool) {
	parts := strings.Split(raw, "_")
	if len(parts) != 3 || parts[0] != "ak" ||
		len(parts[1]) != apiKeyPublicIDLength ||
		len(parts[2]) != apiKeySecretLength {
		return "", "", false
	}
	return parts[1], parts[2], true
}

func normalizePresentedAPIKey(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "Bearer ")
	raw = strings.TrimPrefix(raw, "bearer ")
	if strings.HasPrefix(raw, "sk-") {
		raw = strings.TrimPrefix(raw, "sk-")
	}
	return raw
}

func buildAPIKeyMetadata(raw string) (prefix string, lastFour string) {
	prefixLength := 12
	if len(raw) < prefixLength {
		prefixLength = len(raw)
	}
	lastLength := 4
	if len(raw) < lastLength {
		lastLength = len(raw)
	}
	return raw[:prefixLength], raw[len(raw)-lastLength:]
}

func GenerateAPIKey() (raw string, publicID string, secretHash string, err error) {
	publicID, err = common.GenerateRandomCharsKey(apiKeyPublicIDLength)
	if err != nil {
		return "", "", "", err
	}
	secret, err := common.GenerateRandomCharsKey(apiKeySecretLength)
	if err != nil {
		return "", "", "", err
	}
	raw = apiKeyPrefix + publicID + "_" + secret
	secretHash, err = apiKeyHMAC(secret)
	if err != nil {
		return "", "", "", err
	}
	return raw, publicID, secretHash, nil
}

func (token *Token) PrepareNewAPIKey() (string, error) {
	raw, publicID, secretHash, err := GenerateAPIKey()
	if err != nil {
		return "", err
	}
	token.PublicId = publicID
	token.Key = hashedKeyMarker(publicID)
	token.KeyHash = secretHash
	token.KeyPrefix, token.LastFour = buildAPIKeyMetadata(raw)
	token.LegacyLookupHash = ""
	token.KeyVersion = apiKeyVersionHashed
	token.MigratedAt = common.GetTimestamp()
	if strings.TrimSpace(token.Scopes) == "" {
		token.Scopes = defaultAPIKeyScopes
	}
	return raw, nil
}

func hashedKeyMarker(publicID string) string {
	return "hashed:" + publicID
}

func (token *Token) CacheIdentifier() string {
	if token.PublicId != "" {
		return token.PublicId
	}
	if token.LegacyLookupHash != "" {
		return token.LegacyLookupHash
	}
	return ""
}

func (token *Token) HasScope(scope string) bool {
	scopes := strings.TrimSpace(token.Scopes)
	if scopes == "" {
		return token.KeyVersion == 0 && common.APIKeyLegacyAuthEnabled
	}
	for _, candidate := range strings.Split(scopes, ",") {
		if strings.TrimSpace(candidate) == scope {
			return true
		}
	}
	return false
}

func ValidateAPIKeyPolicyInput(token *Token) error {
	if token == nil {
		return errors.New("API key input is required")
	}
	if len(token.Name) > maxAPIKeyNameLength {
		return errors.New("API key name is too long")
	}
	if len(token.Scopes) > maxAPIKeyScopesLength {
		return errors.New("API key scopes are too long")
	}
	if len(token.ModelLimits) > maxAPIKeyModelListLength {
		return errors.New("API key model restrictions are too long")
	}
	if token.AllowIps != nil && len(*token.AllowIps) > maxAPIKeyIPListLength {
		return errors.New("API key IP restrictions are too long")
	}
	allowedScopes := map[string]bool{"api": true, "usage": true}
	if strings.TrimSpace(token.Scopes) == "" {
		token.Scopes = defaultAPIKeyScopes
	}
	for _, scope := range strings.Split(token.Scopes, ",") {
		scope = strings.TrimSpace(scope)
		if !allowedScopes[scope] {
			return fmt.Errorf("unsupported API key scope: %s", scope)
		}
	}
	if token.ModelLimitsEnabled && strings.TrimSpace(token.ModelLimits) == "" {
		return errors.New("enabled model restrictions cannot be empty")
	}
	for _, ipRange := range token.GetIpLimits() {
		if net.ParseIP(ipRange) == nil {
			if _, _, err := net.ParseCIDR(ipRange); err != nil {
				return fmt.Errorf("invalid API key IP restriction")
			}
		}
	}
	return nil
}

func RotateAPIKey(id int, userID int) (*Token, string, error) {
	if id <= 0 || userID <= 0 {
		return nil, "", errors.New("invalid API key identity")
	}
	var replacement Token
	var raw string
	var oldIdentifier string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current Token
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ?", id, userID).
			First(&current).Error; err != nil {
			return err
		}
		if current.RevokedAt > 0 || current.Status != common.TokenStatusEnabled {
			return ErrAPIKeyConflict
		}
		oldIdentifier = current.CacheIdentifier()
		replacement = current
		replacement.Id = 0
		replacement.PublicId = ""
		replacement.KeyPrefix = ""
		replacement.KeyHash = ""
		replacement.LegacyLookupHash = ""
		replacement.LastFour = ""
		replacement.RevokedAt = 0
		replacement.MigratedAt = 0
		replacement.CreatedTime = getDBTimestampTx(tx)
		replacement.AccessedTime = replacement.CreatedTime
		replacement.DeletedAt = gorm.DeletedAt{}
		var err error
		raw, err = replacement.PrepareNewAPIKey()
		if err != nil {
			return err
		}
		if err := tx.Create(&replacement).Error; err != nil {
			return err
		}
		now := getDBTimestampTx(tx)
		result := tx.Model(&Token{}).
			Where("id = ? AND user_id = ? AND revoked_at = 0", id, userID).
			Updates(map[string]interface{}{
				"status":     common.TokenStatusDisabled,
				"revoked_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAPIKeyConflict
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	if oldIdentifier != "" && common.RedisReady() {
		if err := cacheDeleteToken(oldIdentifier); err != nil {
			common.SysLog(fmt.Sprintf("API key cache invalidation failed: token_id=%d", id))
		}
	}
	return &replacement, raw, nil
}

func (token *Token) GetIpLimits() []string {
	// delete empty spaces
	//split with \n
	ipLimits := make([]string, 0)
	if token.AllowIps == nil {
		return ipLimits
	}
	cleanIps := strings.ReplaceAll(*token.AllowIps, " ", "")
	if cleanIps == "" {
		return ipLimits
	}
	ips := strings.Split(cleanIps, "\n")
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		ip = strings.ReplaceAll(ip, ",", "")
		if ip != "" {
			ipLimits = append(ipLimits, ip)
		}
	}
	return ipLimits
}

func GetAllUserTokens(userId int, startIdx int, num int) ([]*Token, error) {
	var tokens []*Token
	var err error
	err = DB.Where("user_id = ?", userId).Order("id desc").Limit(num).Offset(startIdx).Find(&tokens).Error
	return tokens, err
}

// sanitizeLikePattern 校验并清洗用户输入的 LIKE 搜索模式。
// 规则：
//  1. 转义 ! 和 _（使用 ! 作为 ESCAPE 字符，兼容 MySQL/PostgreSQL/SQLite）
//  2. 连续的 % 合并为单个 %
//  3. 最多允许 2 个 %
//  4. 含 % 时（模糊搜索），去掉 % 后关键词长度必须 >= 2
//  5. 不含 % 时按精确匹配
func sanitizeLikePattern(input string) (string, error) {
	// 1. 先转义 ESCAPE 字符 ! 自身，再转义 _
	//    使用 ! 而非 \ 作为 ESCAPE 字符，避免 MySQL 中反斜杠的字符串转义问题
	input = strings.ReplaceAll(input, "!", "!!")
	input = strings.ReplaceAll(input, `_`, `!_`)

	// 2. 连续的 % 直接拒绝
	if strings.Contains(input, "%%") {
		return "", errors.New("搜索模式中不允许包含连续的 % 通配符")
	}

	// 3. 统计 % 数量，不得超过 2
	count := strings.Count(input, "%")
	if count > 2 {
		return "", errors.New("搜索模式中最多允许包含 2 个 % 通配符")
	}

	// 4. 含 % 时，去掉 % 后关键词长度必须 >= 2
	if count > 0 {
		stripped := strings.ReplaceAll(input, "%", "")
		if len(stripped) < 2 {
			return "", errors.New("使用模糊搜索时，关键词长度至少为 2 个字符")
		}
		return input, nil
	}

	// 5. 无 % 时，精确全匹配
	return input, nil
}

const searchHardLimit = 100

func SearchUserTokens(userId int, keyword string, token string, offset int, limit int) (tokens []*Token, total int64, err error) {
	// model 层强制截断
	if limit <= 0 || limit > searchHardLimit {
		limit = searchHardLimit
	}
	if offset < 0 {
		offset = 0
	}

	// 超量用户（令牌数超过上限）只允许精确搜索，禁止模糊搜索
	maxTokens := operation_setting.GetMaxUserTokens()
	hasFuzzy := strings.Contains(keyword, "%")
	if hasFuzzy {
		count, err := CountUserTokens(userId)
		if err != nil {
			common.SysLog("failed to count user tokens: " + err.Error())
			return nil, 0, errors.New("获取令牌数量失败")
		}
		if int(count) > maxTokens {
			return nil, 0, errors.New("令牌数量超过上限，仅允许精确搜索，请勿使用 % 通配符")
		}
	}

	baseQuery := DB.Model(&Token{}).Where("user_id = ?", userId)

	// 非空才加 LIKE 条件，空则跳过（不过滤该字段）
	if keyword != "" {
		keywordPattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where("name LIKE ? ESCAPE '!'", keywordPattern)
	}
	if token != "" {
		token = strings.TrimSpace(token)
		baseQuery = baseQuery.Where("public_id = ? OR last_four = ?", token, token)
	}

	// 先查匹配总数（用于分页，受 maxTokens 上限保护，避免全表 COUNT）
	err = baseQuery.Limit(maxTokens).Count(&total).Error
	if err != nil {
		common.SysError("failed to count search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}

	// 再分页查数据
	err = baseQuery.Order("id desc").Offset(offset).Limit(limit).Find(&tokens).Error
	if err != nil {
		common.SysError("failed to search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}
	return tokens, total, nil
}

func ValidateUserToken(key string) (token *Token, err error) {
	if key == "" {
		return nil, ErrTokenNotProvided
	}
	token, err = AuthenticateAPIKey(key)
	if err == nil {
		if token.Status == common.TokenStatusExhausted ||
			token.Status == common.TokenStatusExpired ||
			token.Status != common.TokenStatusEnabled ||
			token.RevokedAt > 0 {
			return token, ErrTokenInvalid
		}
		if token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
			if !common.RedisEnabled {
				token.Status = common.TokenStatusExpired
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog("failed to update token status" + err.Error())
				}
			}
			return token, ErrTokenInvalid
		}
		if !token.UnlimitedQuota && token.RemainQuota <= 0 {
			if !common.RedisEnabled {
				token.Status = common.TokenStatusExhausted
				err := token.SelectUpdate()
				if err != nil {
					common.SysLog("failed to update token status" + err.Error())
				}
			}
			return token, ErrTokenInvalid
		}
		return token, nil
	}
	common.SysLog("ValidateUserToken: failed to get token: " + err.Error())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenInvalid
	}
	return nil, fmt.Errorf("%w: %v", ErrDatabase, err)
}

func GetTokenByIds(id int, userId int) (*Token, error) {
	if id == 0 || userId == 0 {
		return nil, errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	var err error = nil
	err = DB.First(&token, "id = ? and user_id = ?", id, userId).Error
	return &token, err
}

func GetTokenById(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	token := Token{Id: id}
	var err error = nil
	err = DB.First(&token, "id = ?", id).Error
	if shouldUpdateRedis(true, err) {
		gopool.Go(func() {
			if err := cacheSetToken(token); err != nil {
				common.SysLog("failed to update user status cache: " + err.Error())
			}
		})
	}
	return &token, err
}

func GetTokenByKey(key string, fromDB bool) (token *Token, err error) {
	return AuthenticateAPIKey(key)
}

func AuthenticateAPIKey(presented string) (*Token, error) {
	presented = normalizePresentedAPIKey(presented)
	if presented == "" {
		return nil, gorm.ErrRecordNotFound
	}

	if publicID, secret, ok := parseHashedAPIKey(presented); ok {
		var token Token
		if err := DB.Where("public_id = ?", publicID).First(&token).Error; err != nil {
			return nil, err
		}
		actualHash, err := apiKeyHMAC(secret)
		if err != nil {
			return nil, err
		}
		if token.KeyVersion != apiKeyVersionHashed ||
			token.KeyHash == "" ||
			!constantTimeHashEqual(actualHash, token.KeyHash) {
			return nil, gorm.ErrRecordNotFound
		}
		scheduleTokenLastUsedUpdate(token.Id, token.AccessedTime)
		return &token, nil
	}

	if !common.APIKeyLegacyAuthEnabled {
		return nil, gorm.ErrRecordNotFound
	}
	lookupHash, err := apiKeyHMAC(presented)
	if err != nil {
		return nil, err
	}
	var token Token
	err = DB.Transaction(func(tx *gorm.DB) error {
		query := lockForUpdate(tx).
			Where("legacy_lookup_hash = ? OR "+commonKeyCol+" = ?", lookupHash, presented).
			Limit(1).
			Find(&token)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		if token.KeyVersion == apiKeyVersionHashed {
			if !constantTimeHashEqual(lookupHash, token.KeyHash) {
				return gorm.ErrRecordNotFound
			}
			return nil
		}
		if token.Key == "" || !hmac.Equal([]byte(token.Key), []byte(presented)) {
			return gorm.ErrRecordNotFound
		}

		prefix, lastFour := buildAPIKeyMetadata(presented)
		publicID := "legacy" + lookupHash[:20]
		now := getDBTimestampTx(tx)
		result := tx.Model(&Token{}).
			Where("id = ? AND "+commonKeyCol+" = ? AND key_version = 0", token.Id, presented).
			Updates(map[string]interface{}{
				"public_id":          publicID,
				"key_prefix":         prefix,
				"key_hash":           lookupHash,
				"legacy_lookup_hash": lookupHash,
				"last_four":          lastFour,
				"key_version":        apiKeyVersionHashed,
				"migrated_at":        now,
				"scopes":             defaultAPIKeyScopes,
				"key":                hashedKeyMarker(publicID),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAPIKeyConflict
		}
		token.PublicId = publicID
		token.KeyPrefix = prefix
		token.KeyHash = lookupHash
		token.LegacyLookupHash = lookupHash
		token.LastFour = lastFour
		token.KeyVersion = apiKeyVersionHashed
		token.MigratedAt = now
		token.Scopes = defaultAPIKeyScopes
		token.Key = hashedKeyMarker(publicID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	scheduleTokenLastUsedUpdate(token.Id, token.AccessedTime)
	return &token, nil
}

func scheduleTokenLastUsedUpdate(tokenID int, previous int64) {
	now := common.GetTimestamp()
	if tokenID <= 0 || now-previous < 300 {
		return
	}
	gopool.Go(func() {
		_ = DB.Model(&Token{}).
			Where("id = ? AND accessed_time < ?", tokenID, now-300).
			Update("accessed_time", now).Error
	})
}

func (token *Token) Insert() error {
	if token.KeyVersion == apiKeyVersionHashed {
		if token.Key != hashedKeyMarker(token.PublicId) || token.PublicId == "" || token.KeyHash == "" {
			return errors.New("invalid hashed API key record")
		}
	}
	return DB.Create(token).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (token *Token) Update() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	err = DB.Model(token).Select("name", "status", "expired_time", "remain_quota", "unlimited_quota",
		"model_limits_enabled", "model_limits", "allow_ips", "group", "cross_group_retry", "scopes").Updates(token).Error
	return err
}

func (token *Token) SelectUpdate() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	// This can update zero values
	return DB.Model(token).Select("accessed_time", "status").Updates(token).Error
}

func (token *Token) Delete() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheDeleteToken(token.CacheIdentifier())
				if err != nil {
					common.SysLog("failed to delete token cache: " + err.Error())
				}
			})
		}
	}()
	now := common.GetTimestamp()
	err = DB.Model(token).Updates(map[string]interface{}{
		"status":     common.TokenStatusDisabled,
		"revoked_at": now,
	}).Error
	return err
}

func (token *Token) IsModelLimitsEnabled() bool {
	return token.ModelLimitsEnabled
}

func (token *Token) GetModelLimits() []string {
	if token.ModelLimits == "" {
		return []string{}
	}
	return strings.Split(token.ModelLimits, ",")
}

func (token *Token) GetModelLimitsMap() map[string]bool {
	limits := token.GetModelLimits()
	limitsMap := make(map[string]bool)
	for _, limit := range limits {
		limitsMap[limit] = true
	}
	return limitsMap
}

func DisableModelLimits(tokenId int) error {
	token, err := GetTokenById(tokenId)
	if err != nil {
		return err
	}
	token.ModelLimitsEnabled = false
	token.ModelLimits = ""
	return token.Update()
}

func DeleteTokenById(id int, userId int) (err error) {
	// Why we need userId here? In case user want to delete other's token.
	if id == 0 || userId == 0 {
		return errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	err = DB.Where(token).First(&token).Error
	if err != nil {
		return err
	}
	return token.Delete()
}

// API key quota mutations are always persisted synchronously. The batch updater
// remains available for non-balance counters only.
func IncreaseTokenQuota(tokenId int, key string, quota int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if err := increaseTokenQuota(tokenId, quota); err != nil {
		return err
	}
	if common.RedisReady() {
		if err := cacheDeleteToken(key); err != nil {
			common.SysLog(fmt.Sprintf("token quota cache invalidation failed: token_id=%d error=%s", tokenId, err.Error()))
		}
	}
	return nil
}

func increaseTokenQuota(id int, quota int) (err error) {
	err = DB.Model(&Token{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota + ?", quota),
			"used_quota":    gorm.Expr("used_quota - ?", quota),
			"accessed_time": common.GetTimestamp(),
		},
	).Error
	return err
}

func DecreaseTokenQuota(id int, key string, quota int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if err := decreaseTokenQuota(id, quota); err != nil {
		return err
	}
	if common.RedisReady() {
		if err := cacheDeleteToken(key); err != nil {
			common.SysLog(fmt.Sprintf("token quota cache invalidation failed: token_id=%d error=%s", id, err.Error()))
		}
	}
	return nil
}

func decreaseTokenQuota(id int, quota int) (err error) {
	err = DB.Model(&Token{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota - ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"accessed_time": common.GetTimestamp(),
		},
	).Error
	return err
}

// AdjustUnlimitedTokenUsedQuota updates usage accounting for an unlimited key
// without changing remain_quota. A negative delta is bounded so retries cannot
// drive used_quota below zero.
func AdjustUnlimitedTokenUsedQuota(id int, key string, delta int) error {
	if delta == 0 {
		return nil
	}
	query := DB.Model(&Token{}).Where("id = ? AND unlimited_quota = ?", id, true)
	if delta < 0 {
		query = query.Where("used_quota >= ?", -delta)
	}
	result := query.Update("used_quota", gorm.Expr("used_quota + ?", delta))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("failed to adjust unlimited token used quota: token_id=%d delta=%d", id, delta)
	}
	if common.RedisReady() {
		if err := cacheDeleteToken(key); err != nil {
			common.SysLog(fmt.Sprintf("unlimited token cache invalidation failed: token_id=%d error=%s", id, err.Error()))
		}
	}
	return nil
}

// CountUserTokens returns total number of tokens for the given user, used for pagination
func CountUserTokens(userId int) (int64, error) {
	var total int64
	err := DB.Model(&Token{}).Where("user_id = ?", userId).Count(&total).Error
	return total, err
}

// BatchDeleteTokens 删除指定用户的一组令牌，返回成功删除数量
func BatchDeleteTokens(ids []int, userId int) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}

	tx := DB.Begin()

	var tokens []Token
	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	now := getDBTimestampTx(tx)
	if err := tx.Model(&Token{}).
		Where("user_id = ? AND id IN (?)", userId, ids).
		Updates(map[string]interface{}{
			"status":     common.TokenStatusDisabled,
			"revoked_at": now,
		}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}
	if err := tx.Where("user_id = ? AND id IN (?)", userId, ids).Delete(&Token{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.CacheIdentifier())
			}
		})
	}

	return len(tokens), nil
}

// InvalidateUserTokensCache 清理指定用户所有令牌在 Redis 中的缓存，
// 配合 InvalidateUserCache 使用，可在用户被禁用/删除时立即阻断其令牌的请求。
// 下一次请求将从数据库重新加载令牌及用户状态，从而立即识别出被禁用的用户。
func InvalidateUserTokensCache(userId int) error {
	if !common.RedisEnabled {
		return nil
	}
	if userId <= 0 {
		return errors.New("userId 无效")
	}
	var tokens []Token
	if err := DB.Unscoped().
		Select("id", "public_id", "legacy_lookup_hash").
		Where("user_id = ?", userId).
		Find(&tokens).Error; err != nil {
		return err
	}
	var firstErr error
	for _, t := range tokens {
		identifier := t.CacheIdentifier()
		if identifier == "" {
			continue
		}
		if err := cacheDeleteToken(identifier); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
