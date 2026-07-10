package vertex

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	geminitask "github.com/QuantumNous/new-api/relay/channel/task/gemini"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	vertexcore "github.com/QuantumNous/new-api/relay/channel/vertex"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
)

// ============================
// Request / Response structures
// ============================

type fetchOperationPayload struct {
	OperationName string `json:"operationName"`
}

type submitResponse struct {
	Name string `json:"name"`
}

type operationVideo struct {
	MimeType           string `json:"mimeType"`
	BytesBase64Encoded string `json:"bytesBase64Encoded"`
	Encoding           string `json:"encoding"`
}

type operationResponse struct {
	Name     string `json:"name"`
	Done     bool   `json:"done"`
	Response struct {
		Type                  string           `json:"@type"`
		RaiMediaFilteredCount int              `json:"raiMediaFilteredCount"`
		Videos                []operationVideo `json:"videos"`
		BytesBase64Encoded    string           `json:"bytesBase64Encoded"`
		Encoding              string           `json:"encoding"`
		Video                 string           `json:"video"`
	} `json:"response"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

const (
	omniAPIVersion     = "v1beta1"
	omniGlobalRegion   = "global"
	omniTaskIDPrefix   = "omni:"
	omniBillingSeconds = 8
)

type interactionResponseFormat struct {
	Type        string `json:"type,omitempty"`
	AspectRatio string `json:"aspect_ratio,omitempty"`
}

type interactionVideoConfig struct {
	Task string `json:"task,omitempty"`
}

type interactionGenerationConfig struct {
	VideoConfig *interactionVideoConfig `json:"video_config,omitempty"`
}

type interactionRequestPayload struct {
	Model                 string                       `json:"model"`
	Input                 any                          `json:"input"`
	ResponseFormat        *interactionResponseFormat   `json:"response_format,omitempty"`
	GenerationConfig      *interactionGenerationConfig `json:"generation_config,omitempty"`
	PreviousInteractionID string                       `json:"previous_interaction_id,omitempty"`
	Background            *bool                        `json:"background,omitempty"`
}

type interactionMedia struct {
	Type          string `json:"type,omitempty"`
	MimeType      string `json:"mime_type,omitempty"`
	MimeTypeCamel string `json:"mimeType,omitempty"`
	Data          string `json:"data,omitempty"`
	URI           string `json:"uri,omitempty"`
	Text          string `json:"text,omitempty"`
}

type interactionStep struct {
	Type    string             `json:"type,omitempty"`
	Content []interactionMedia `json:"content,omitempty"`
}

type interactionResponse struct {
	ID          string            `json:"id"`
	Name        string            `json:"name,omitempty"`
	Status      string            `json:"status,omitempty"`
	Model       string            `json:"model,omitempty"`
	Object      string            `json:"object,omitempty"`
	Steps       []interactionStep `json:"steps,omitempty"`
	OutputVideo *interactionMedia `json:"output_video,omitempty"`
	Error       struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// ============================
// Adaptor implementation
// ============================

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

// ValidateRequestAndSetAction parses body, validates fields and sets default action.
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	// Use the standard validation method for TaskSubmitReq
	return relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionTextGenerate)
}

// BuildRequestURL constructs the upstream URL.
func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	adc := &vertexcore.Credentials{}
	if err := common.Unmarshal([]byte(a.apiKey), adc); err != nil {
		return "", fmt.Errorf("failed to decode credentials: %w", err)
	}
	modelName := info.UpstreamModelName
	if modelName == "" {
		modelName = "veo-3.0-generate-001"
	}
	if geminitask.IsOmniModel(modelName) {
		return buildOmniInteractionsURL(a.baseURL, adc.ProjectID), nil
	}

	region := vertexcore.GetModelRegion(info.ApiVersion, modelName)
	if strings.TrimSpace(region) == "" {
		region = "global"
	}
	return vertexcore.BuildGoogleModelURL(a.baseURL, vertexcore.DefaultAPIVersion, adc.ProjectID, region, modelName, "predictLongRunning"), nil
}

// BuildRequestHeader sets required headers.
func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	adc := &vertexcore.Credentials{}
	if err := common.Unmarshal([]byte(a.apiKey), adc); err != nil {
		return fmt.Errorf("failed to decode credentials: %w", err)
	}

	proxy := ""
	if info != nil {
		proxy = info.ChannelSetting.Proxy
	}
	token, err := vertexcore.AcquireAccessToken(*adc, proxy)
	if err != nil {
		return fmt.Errorf("failed to acquire access token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-goog-user-project", adc.ProjectID)
	return nil
}

// EstimateBilling returns OtherRatios based on durationSeconds and resolution.
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	v, ok := c.Get("task_request")
	if !ok {
		return nil
	}
	req := v.(relaycommon.TaskSubmitReq)

	if geminitask.IsOmniModel(info.UpstreamModelName) {
		return map[string]float64{
			"seconds": omniBillingSeconds,
		}
	}

	return geminitask.EstimateVeoBilling(req, info.UpstreamModelName)
}

// BuildRequestBody converts request into Vertex specific format.
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	v, ok := c.Get("task_request")
	if !ok {
		return nil, fmt.Errorf("request not found in context")
	}
	req := v.(relaycommon.TaskSubmitReq)

	if geminitask.IsOmniModel(info.UpstreamModelName) {
		return buildOmniRequestBody(req, info.UpstreamModelName)
	}

	instance := geminitask.VeoInstance{Prompt: req.Prompt}
	if img := geminitask.ExtractMultipartImage(c, info); img != nil {
		instance.Image = img
	} else if len(req.Images) > 0 {
		if parsed := geminitask.ParseImageInput(req.Images[0]); parsed != nil {
			instance.Image = parsed
			info.Action = constant.TaskActionGenerate
		}
	}

	params := &geminitask.VeoParameters{}
	if err := taskcommon.UnmarshalMetadata(req.Metadata, params); err != nil {
		return nil, fmt.Errorf("unmarshal metadata failed: %w", err)
	}
	if params.DurationSeconds == 0 && req.Duration > 0 {
		params.DurationSeconds = req.Duration
	}
	if params.Resolution == "" && req.Size != "" {
		params.Resolution = geminitask.SizeToVeoResolution(req.Size)
	}
	if params.AspectRatio == "" && req.Size != "" {
		params.AspectRatio = geminitask.SizeToVeoAspectRatio(req.Size)
	}
	params.Resolution = strings.ToLower(params.Resolution)
	params.SampleCount = 1

	body := geminitask.VeoRequestPayload{
		Instances:  []geminitask.VeoInstance{instance},
		Parameters: params,
	}

	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse handles upstream response, returns taskID etc.
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()

	if geminitask.IsOmniModel(info.UpstreamModelName) {
		return a.doOmniResponse(c, responseBody, info)
	}

	var s submitResponse
	if err := common.Unmarshal(responseBody, &s); err != nil {
		return "", nil, service.TaskErrorWrapper(err, "unmarshal_response_failed", http.StatusInternalServerError)
	}
	if strings.TrimSpace(s.Name) == "" {
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("missing operation name"), "invalid_response", http.StatusInternalServerError)
	}
	localID := taskcommon.EncodeLocalTaskID(s.Name)
	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)
	return localID, responseBody, nil
}

func (a *TaskAdaptor) GetModelList() []string {
	return []string{
		"veo-3.0-generate-001",
		"veo-3.0-fast-generate-001",
		"veo-3.1-generate-001",
		"veo-3.1-fast-generate-001",
		"veo-3.1-generate-preview",
		"veo-3.1-fast-generate-preview",
		geminitask.OmniFlashPreviewModel,
	}
}
func (a *TaskAdaptor) GetChannelName() string { return "vertex" }

func buildFetchOperationURL(baseURL, upstreamName string) (string, error) {
	region := extractRegionFromOperationName(upstreamName)
	if region == "" {
		region = "us-central1"
	}
	project := extractProjectFromOperationName(upstreamName)
	modelName := extractModelFromOperationName(upstreamName)
	if strings.TrimSpace(modelName) == "" {
		return "", fmt.Errorf("cannot extract model from operation name")
	}
	if strings.TrimSpace(project) == "" {
		return "", fmt.Errorf("cannot extract project from operation name")
	}
	return vertexcore.BuildGoogleModelURL(baseURL, vertexcore.DefaultAPIVersion, project, region, modelName, "fetchPredictOperation"), nil
}

// FetchTask fetch task status
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}
	upstreamName, err := taskcommon.DecodeLocalTaskID(taskID)
	if err != nil {
		return nil, fmt.Errorf("decode task_id failed: %w", err)
	}
	if strings.HasPrefix(upstreamName, omniTaskIDPrefix) {
		return fetchOmniInteraction(baseUrl, key, strings.TrimPrefix(upstreamName, omniTaskIDPrefix), proxy)
	}
	url, err := buildFetchOperationURL(baseUrl, upstreamName)
	if err != nil {
		return nil, err
	}
	payload := fetchOperationPayload{OperationName: upstreamName}
	data, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	adc := &vertexcore.Credentials{}
	if err := common.Unmarshal([]byte(key), adc); err != nil {
		return nil, fmt.Errorf("failed to decode credentials: %w", err)
	}
	token, err := vertexcore.AcquireAccessToken(*adc, proxy)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire access token: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-goog-user-project", adc.ProjectID)
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	if isOmniInteractionResponse(respBody) {
		return parseOmniTaskResult(respBody)
	}

	var op operationResponse
	if err := common.Unmarshal(respBody, &op); err != nil {
		return nil, fmt.Errorf("unmarshal operation response failed: %w", err)
	}
	ti := &relaycommon.TaskInfo{}
	if op.Error.Message != "" {
		ti.Status = model.TaskStatusFailure
		ti.Reason = op.Error.Message
		ti.Progress = "100%"
		return ti, nil
	}
	if !op.Done {
		ti.Status = model.TaskStatusInProgress
		ti.Progress = "50%"
		return ti, nil
	}
	ti.Status = model.TaskStatusSuccess
	ti.Progress = "100%"
	if len(op.Response.Videos) > 0 {
		v0 := op.Response.Videos[0]
		if v0.BytesBase64Encoded != "" {
			mime := strings.TrimSpace(v0.MimeType)
			if mime == "" {
				enc := strings.TrimSpace(v0.Encoding)
				if enc == "" {
					enc = "mp4"
				}
				if strings.Contains(enc, "/") {
					mime = enc
				} else {
					mime = "video/" + enc
				}
			}
			ti.Url = "data:" + mime + ";base64," + v0.BytesBase64Encoded
			return ti, nil
		}
	}
	if op.Response.BytesBase64Encoded != "" {
		enc := strings.TrimSpace(op.Response.Encoding)
		if enc == "" {
			enc = "mp4"
		}
		mime := enc
		if !strings.Contains(enc, "/") {
			mime = "video/" + enc
		}
		ti.Url = "data:" + mime + ";base64," + op.Response.BytesBase64Encoded
		return ti, nil
	}
	if op.Response.Video != "" { // some variants use `video` as base64
		enc := strings.TrimSpace(op.Response.Encoding)
		if enc == "" {
			enc = "mp4"
		}
		mime := enc
		if !strings.Contains(enc, "/") {
			mime = "video/" + enc
		}
		ti.Url = "data:" + mime + ";base64," + op.Response.Video
		return ti, nil
	}
	return ti, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	// Use GetUpstreamTaskID() to get the real upstream operation name for model extraction.
	// task.TaskID is now a public task_xxxx ID, no longer a base64-encoded upstream name.
	upstreamTaskID := task.GetUpstreamTaskID()
	upstreamName, err := taskcommon.DecodeLocalTaskID(upstreamTaskID)
	if err != nil {
		upstreamName = ""
	}
	modelName := extractModelFromOperationName(upstreamName)
	if strings.HasPrefix(upstreamName, omniTaskIDPrefix) {
		modelName = task.Properties.OriginModelName
		if strings.TrimSpace(modelName) == "" {
			modelName = geminitask.OmniFlashPreviewModel
		}
	}
	if strings.TrimSpace(modelName) == "" {
		modelName = "veo-3.0-generate-001"
	}
	v := dto.NewOpenAIVideo()
	v.ID = task.TaskID
	v.Model = modelName
	v.Status = task.Status.ToVideoStatus()
	v.SetProgressStr(task.Progress)
	v.CreatedAt = task.CreatedAt
	v.CompletedAt = task.UpdatedAt
	if resultURL := task.GetResultURL(); strings.HasPrefix(resultURL, "data:") && len(resultURL) > 0 {
		v.SetMetadata("url", resultURL)
	}

	return common.Marshal(v)
}

func buildOmniInteractionsURL(baseURL, projectID string) string {
	return vertexcore.BuildAPIBaseURL(baseURL, omniAPIVersion, projectID, omniGlobalRegion) + "/interactions"
}

func buildOmniInteractionFetchURL(baseURL, resource string) (string, error) {
	resource = strings.TrimSpace(resource)
	if resource == "" {
		return "", fmt.Errorf("empty interaction resource")
	}
	if strings.HasPrefix(resource, "http://") || strings.HasPrefix(resource, "https://") {
		return resource, nil
	}
	if !strings.HasPrefix(resource, "projects/") {
		return "", fmt.Errorf("invalid interaction resource: %s", resource)
	}
	return vertexcore.BuildAPIBaseURL(baseURL, omniAPIVersion, "", omniGlobalRegion) + "/" + strings.TrimPrefix(resource, "/"), nil
}

func buildOmniInteractionResource(projectID, idOrName string) (string, error) {
	projectID = strings.TrimSpace(projectID)
	idOrName = strings.TrimSpace(idOrName)
	if projectID == "" {
		return "", fmt.Errorf("missing vertex project id")
	}
	if idOrName == "" {
		return "", fmt.Errorf("missing interaction id")
	}
	if strings.HasPrefix(idOrName, "projects/") {
		return idOrName, nil
	}
	if idx := strings.Index(idOrName, "/interactions/"); idx >= 0 {
		if strings.HasPrefix(idOrName, "projects/") {
			return idOrName, nil
		}
		idOrName = idOrName[idx+len("/interactions/"):]
	}
	return fmt.Sprintf("projects/%s/locations/%s/interactions/%s", projectID, omniGlobalRegion, idOrName), nil
}

func buildOmniRequestBody(req relaycommon.TaskSubmitReq, modelName string) (io.Reader, error) {
	background := true
	input, imageCount := buildOmniInput(req)
	task := resolveOmniTask(req.Metadata, imageCount)
	payload := interactionRequestPayload{
		Model:      modelName,
		Input:      input,
		Background: &background,
		ResponseFormat: &interactionResponseFormat{
			Type:        "video",
			AspectRatio: resolveOmniAspectRatio(req.Metadata, req.Size),
		},
		GenerationConfig: &interactionGenerationConfig{
			VideoConfig: &interactionVideoConfig{
				Task: task,
			},
		},
		PreviousInteractionID: resolveOmniPreviousInteractionID(req.Metadata),
	}
	data, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func buildOmniInput(req relaycommon.TaskSubmitReq) (any, int) {
	items := make([]interactionMedia, 0, len(req.Images)+1)
	for _, image := range req.Images {
		parsed := geminitask.ParseImageInput(image)
		if parsed == nil || strings.TrimSpace(parsed.BytesBase64Encoded) == "" {
			continue
		}
		mimeType := strings.TrimSpace(parsed.MimeType)
		if mimeType == "" {
			mimeType = "image/png"
		}
		items = append(items, interactionMedia{
			Type:     "image",
			Data:     parsed.BytesBase64Encoded,
			MimeType: mimeType,
		})
	}
	imageCount := len(items)
	prompt := strings.TrimSpace(req.Prompt)
	if imageCount == 0 {
		return req.Prompt, 0
	}
	if prompt != "" {
		items = append(items, interactionMedia{
			Type: "text",
			Text: req.Prompt,
		})
	}
	return items, imageCount
}

func resolveOmniTask(metadata map[string]any, imageCount int) string {
	if metadata != nil {
		for _, key := range []string{"task", "omniTask", "videoTask"} {
			if v, ok := metadata[key].(string); ok {
				if task := normalizeOmniTask(v); task != "" {
					return task
				}
			}
		}
	}
	if imageCount > 1 {
		return "reference_to_video"
	}
	if imageCount == 1 {
		return "image_to_video"
	}
	return "text_to_video"
}

func normalizeOmniTask(task string) string {
	switch strings.TrimSpace(task) {
	case "text_to_video", "image_to_video", "reference_to_video", "edit":
		return strings.TrimSpace(task)
	default:
		return ""
	}
}

func resolveOmniPreviousInteractionID(metadata map[string]any) string {
	if metadata == nil {
		return ""
	}
	for _, key := range []string{"previous_interaction_id", "previousInteractionId"} {
		if v, ok := metadata[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func resolveOmniAspectRatio(metadata map[string]any, size string) string {
	if metadata != nil {
		for _, key := range []string{"aspect_ratio", "aspectRatio"} {
			if v, ok := metadata[key].(string); ok && strings.TrimSpace(v) != "" {
				if strings.TrimSpace(v) == "9:16" {
					return "9:16"
				}
				return "16:9"
			}
		}
	}
	if geminitask.SizeToVeoAspectRatio(size) == "9:16" {
		return "9:16"
	}
	return "16:9"
}

func (a *TaskAdaptor) doOmniResponse(c *gin.Context, responseBody []byte, info *relaycommon.RelayInfo) (string, []byte, *dto.TaskError) {
	var interaction interactionResponse
	if err := common.Unmarshal(responseBody, &interaction); err != nil {
		return "", nil, service.TaskErrorWrapper(err, "unmarshal_response_failed", http.StatusInternalServerError)
	}

	interactionID := strings.TrimSpace(interaction.ID)
	if interactionID == "" {
		interactionID = strings.TrimSpace(interaction.Name)
	}
	if interactionID == "" {
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("missing interaction id"), "invalid_response", http.StatusInternalServerError)
	}

	adc := &vertexcore.Credentials{}
	if err := common.Unmarshal([]byte(a.apiKey), adc); err != nil {
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("failed to decode credentials: %w", err), "invalid_credentials", http.StatusInternalServerError)
	}
	resource, err := buildOmniInteractionResource(adc.ProjectID, interactionID)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "invalid_response", http.StatusInternalServerError)
	}

	localID := taskcommon.EncodeLocalTaskID(omniTaskIDPrefix + resource)
	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)
	return localID, responseBody, nil
}

func fetchOmniInteraction(baseURL, key, resource, proxy string) (*http.Response, error) {
	url, err := buildOmniInteractionFetchURL(baseURL, resource)
	if err != nil {
		return nil, err
	}
	adc := &vertexcore.Credentials{}
	if err := common.Unmarshal([]byte(key), adc); err != nil {
		return nil, fmt.Errorf("failed to decode credentials: %w", err)
	}
	token, err := vertexcore.AcquireAccessToken(*adc, proxy)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire access token: %w", err)
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-goog-user-project", adc.ProjectID)
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func isOmniInteractionResponse(respBody []byte) bool {
	var raw map[string]any
	if err := common.Unmarshal(respBody, &raw); err != nil {
		return false
	}
	if object, _ := raw["object"].(string); object == "interaction" {
		return true
	}
	if _, ok := raw["steps"]; ok {
		return true
	}
	if _, ok := raw["output_video"]; ok {
		return true
	}
	return false
}

func parseOmniTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var interaction interactionResponse
	if err := common.Unmarshal(respBody, &interaction); err != nil {
		return nil, fmt.Errorf("unmarshal interaction response failed: %w", err)
	}

	ti := &relaycommon.TaskInfo{}
	if interaction.Error.Message != "" {
		ti.Status = model.TaskStatusFailure
		ti.Reason = interaction.Error.Message
		ti.Progress = taskcommon.ProgressComplete
		return ti, nil
	}

	videoURL := extractOmniVideoURL(interaction)
	status := strings.ToLower(strings.TrimSpace(interaction.Status))
	switch status {
	case "completed", "complete", "succeeded", "success":
		if videoURL == "" {
			ti.Status = model.TaskStatusFailure
			ti.Reason = "omni interaction completed without video output"
			ti.Progress = taskcommon.ProgressComplete
			return ti, nil
		}
		ti.Status = model.TaskStatusSuccess
		ti.Progress = taskcommon.ProgressComplete
		ti.Url = videoURL
	case "failed", "failure", "cancelled", "canceled", "expired":
		ti.Status = model.TaskStatusFailure
		ti.Reason = "omni interaction failed"
		ti.Progress = taskcommon.ProgressComplete
	case "", "queued", "pending", "running", "processing", "in_progress":
		if videoURL != "" {
			ti.Status = model.TaskStatusSuccess
			ti.Progress = taskcommon.ProgressComplete
			ti.Url = videoURL
			return ti, nil
		}
		ti.Status = model.TaskStatusInProgress
		ti.Progress = "50%"
	default:
		ti.Status = model.TaskStatusInProgress
		ti.Progress = "50%"
	}
	return ti, nil
}

func extractOmniVideoURL(interaction interactionResponse) string {
	if interaction.OutputVideo != nil {
		if url := buildOmniVideoURL(*interaction.OutputVideo); url != "" {
			return url
		}
	}
	for i := len(interaction.Steps) - 1; i >= 0; i-- {
		step := interaction.Steps[i]
		for _, content := range step.Content {
			if strings.EqualFold(strings.TrimSpace(content.Type), "video") {
				if url := buildOmniVideoURL(content); url != "" {
					return url
				}
			}
		}
	}
	return ""
}

func buildOmniVideoURL(media interactionMedia) string {
	data := strings.TrimSpace(media.Data)
	if data != "" {
		if strings.HasPrefix(data, "data:") {
			return data
		}
		mimeType := strings.TrimSpace(media.MimeType)
		if mimeType == "" {
			mimeType = strings.TrimSpace(media.MimeTypeCamel)
		}
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		return "data:" + mimeType + ";base64," + data
	}
	if uri := strings.TrimSpace(media.URI); uri != "" {
		return uri
	}
	return ""
}

// ============================
// helpers
// ============================

var regionRe = regexp.MustCompile(`locations/([a-z0-9-]+)/`)

func extractRegionFromOperationName(name string) string {
	m := regionRe.FindStringSubmatch(name)
	if len(m) == 2 {
		return m[1]
	}
	return ""
}

var modelRe = regexp.MustCompile(`models/([^/]+)/operations/`)

func extractModelFromOperationName(name string) string {
	m := modelRe.FindStringSubmatch(name)
	if len(m) == 2 {
		return m[1]
	}
	idx := strings.Index(name, "models/")
	if idx >= 0 {
		s := name[idx+len("models/"):]
		if p := strings.Index(s, "/operations/"); p > 0 {
			return s[:p]
		}
	}
	return ""
}

var projectRe = regexp.MustCompile(`projects/([^/]+)/locations/`)

func extractProjectFromOperationName(name string) string {
	m := projectRe.FindStringSubmatch(name)
	if len(m) == 2 {
		return m[1]
	}
	return ""
}
