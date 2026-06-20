package controller

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
)

// PlaygroundExecute proxies a code-execution request from the playground to the
// sandbox sidecar (E2B code-interpreter). The user is already authenticated by
// the UserAuth middleware; this handler never exposes the sidecar or its
// internal secret to the browser.
//
// Flow: browser (session) -> /pg/execute -> sidecar /execute -> E2B sandbox.
//
// Config (env on the newapi service):
//   SANDBOX_SIDECAR_URL     - base URL of the sidecar Cloud Run service
//   SANDBOX_INTERNAL_SECRET - shared secret the sidecar requires
func PlaygroundExecute(c *gin.Context) {
	sidecarURL := strings.TrimRight(common.GetEnvOrDefaultString("SANDBOX_SIDECAR_URL", ""), "/")
	internalSecret := common.GetEnvOrDefaultString("SANDBOX_INTERNAL_SECRET", "")
	if sidecarURL == "" || internalSecret == "" {
		c.JSON(http.StatusNotImplemented, gin.H{"ok": false, "error": "code execution is not configured"})
		return
	}

	var req struct {
		Code     string `json:"code"`
		Language string `json:"language"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "invalid request body"})
		return
	}
	if strings.TrimSpace(req.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "code is required"})
		return
	}
	if req.Language == "" {
		req.Language = "python"
	}

	payload, err := common.Marshal(map[string]string{"code": req.Code, "language": req.Language})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "failed to encode request"})
		return
	}

	upstream, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, sidecarURL+"/execute", bytes.NewReader(payload))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "error": "failed to build request"})
		return
	}
	upstream.Header.Set("Content-Type", "application/json")
	upstream.Header.Set("X-Internal-Secret", internalSecret)
	// Cloud Run service-to-service auth: present an identity token scoped to the
	// sidecar. Best-effort — outside Cloud Run (local dev) the metadata server is
	// absent and we fall back to the internal secret only.
	if token, err := fetchCloudRunIDToken(sidecarURL); err == nil && token != "" {
		upstream.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(upstream)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "sandbox unavailable: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 96*1024*1024))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "error": "failed to read sandbox response"})
		return
	}
	c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}

// fetchCloudRunIDToken obtains a Google-signed identity token for the given
// audience from the instance metadata server. Only works on GCP compute
// (Cloud Run / GCE); returns an error elsewhere.
func fetchCloudRunIDToken(audience string) (string, error) {
	metaURL := "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=" + url.QueryEscape(audience)
	req, err := http.NewRequest(http.MethodGet, metaURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New("metadata identity token unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}
