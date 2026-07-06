package gemini

import (
	"strconv"
	"strings"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const OmniFlashPreviewModel = "gemini-omni-flash-preview"

func IsOmniModel(modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), OmniFlashPreviewModel)
}

// ParseVeoDurationSeconds extracts durationSeconds from metadata.
// Returns 8 (Veo default) when not specified or invalid.
func ParseVeoDurationSeconds(metadata map[string]any) int {
	if metadata == nil {
		return 8
	}
	v, ok := metadata["durationSeconds"]
	if !ok {
		return 8
	}
	switch n := v.(type) {
	case float64:
		if int(n) > 0 {
			return int(n)
		}
	case int:
		if n > 0 {
			return n
		}
	}
	return 8
}

// ParseVeoResolution extracts resolution from metadata.
// Returns "720p" when not specified.
func ParseVeoResolution(metadata map[string]any) string {
	if metadata == nil {
		return "720p"
	}
	v, ok := metadata["resolution"]
	if !ok {
		return "720p"
	}
	if s, ok := v.(string); ok && s != "" {
		return strings.ToLower(s)
	}
	return "720p"
}

// ResolveVeoDuration returns the effective duration in seconds.
// Priority: metadata["durationSeconds"] > stdDuration > stdSeconds > default (8).
// The result is capped because it is used as a billing multiplier and the
// metadata path bypasses standard request validation.
func ResolveVeoDuration(metadata map[string]any, stdDuration int, stdSeconds string) int {
	if metadata != nil {
		if _, exists := metadata["durationSeconds"]; exists {
			if d := ParseVeoDurationSeconds(metadata); d > 0 {
				return min(d, relaycommon.MaxTaskDurationSeconds)
			}
		}
	}
	if stdDuration > 0 {
		return min(stdDuration, relaycommon.MaxTaskDurationSeconds)
	}
	if s, err := strconv.Atoi(stdSeconds); err == nil && s > 0 {
		return min(s, relaycommon.MaxTaskDurationSeconds)
	}
	return 8
}

// ResolveVeoResolution returns the effective resolution string (lowercase).
// Priority: metadata["resolution"] > SizeToVeoResolution(stdSize) > default ("720p").
func ResolveVeoResolution(metadata map[string]any, stdSize string) string {
	if metadata != nil {
		if _, exists := metadata["resolution"]; exists {
			if r := ParseVeoResolution(metadata); r != "" {
				return r
			}
		}
	}
	if stdSize != "" {
		return SizeToVeoResolution(stdSize)
	}
	return "720p"
}

// ResolveVeoGenerateAudio returns whether the request includes generated audio.
// Veo defaults to video with audio when generateAudio is omitted.
func ResolveVeoGenerateAudio(metadata map[string]any) bool {
	if metadata == nil {
		return true
	}
	generateAudio, ok := metadata["generateAudio"].(bool)
	if !ok {
		return true
	}
	return generateAudio
}

// SizeToVeoResolution converts a "WxH" size string to a Veo resolution label.
func SizeToVeoResolution(size string) string {
	parts := strings.SplitN(strings.ToLower(size), "x", 2)
	if len(parts) != 2 {
		return "720p"
	}
	w, _ := strconv.Atoi(parts[0])
	h, _ := strconv.Atoi(parts[1])
	maxDim := w
	if h > maxDim {
		maxDim = h
	}
	if maxDim >= 3840 {
		return "4k"
	}
	if maxDim >= 1920 {
		return "1080p"
	}
	return "720p"
}

// SizeToVeoAspectRatio converts a "WxH" size string to a Veo aspect ratio.
func SizeToVeoAspectRatio(size string) string {
	parts := strings.SplitN(strings.ToLower(size), "x", 2)
	if len(parts) != 2 {
		return "16:9"
	}
	w, _ := strconv.Atoi(parts[0])
	h, _ := strconv.Atoi(parts[1])
	if w <= 0 || h <= 0 {
		return "16:9"
	}
	if h > w {
		return "9:16"
	}
	return "16:9"
}

type veoPricePerSecond struct {
	withAudio float64
	noAudio   float64
}

func resolveVeoPricePerSecond(modelName, resolution string) veoPricePerSecond {
	model := strings.ToLower(modelName)
	res := strings.ToLower(resolution)

	if strings.Contains(model, "3.1-fast-generate") {
		switch res {
		case "1080p":
			return veoPricePerSecond{withAudio: 0.12, noAudio: 0.10}
		case "4k":
			return veoPricePerSecond{withAudio: 0.30, noAudio: 0.25}
		default:
			return veoPricePerSecond{withAudio: 0.10, noAudio: 0.08}
		}
	}

	if strings.Contains(model, "3.0-fast-generate") {
		if res == "1080p" {
			return veoPricePerSecond{withAudio: 0.12, noAudio: 0.10}
		}
		return veoPricePerSecond{withAudio: 0.10, noAudio: 0.08}
	}

	if res == "4k" && strings.Contains(model, "3.1-generate") {
		return veoPricePerSecond{withAudio: 0.60, noAudio: 0.40}
	}
	return veoPricePerSecond{withAudio: 0.40, noAudio: 0.20}
}

// VeoResolutionRatio returns the pricing multiplier for the given resolution.
// ModelPrice is the model's 720p video+audio price per second.
func VeoResolutionRatio(modelName, resolution string) float64 {
	basePrice := resolveVeoPricePerSecond(modelName, "720p").withAudio
	targetPrice := resolveVeoPricePerSecond(modelName, resolution).withAudio
	return targetPrice / basePrice
}

// VeoAudioRatio returns the no-audio discount relative to the matching
// video-with-audio resolution price. ModelPrice remains the 720p audio price.
func VeoAudioRatio(modelName, resolution string, generateAudio bool) float64 {
	if generateAudio {
		return 1.0
	}
	price := resolveVeoPricePerSecond(modelName, resolution)
	return price.noAudio / price.withAudio
}

// EstimateVeoBilling builds the shared Veo billing ratios used by both Gemini
// API and Vertex AI task adaptors.
func EstimateVeoBilling(req relaycommon.TaskSubmitReq, modelName string) map[string]float64 {
	seconds := ResolveVeoDuration(req.Metadata, req.Duration, req.Seconds)
	resolution := ResolveVeoResolution(req.Metadata, req.Size)
	return map[string]float64{
		"seconds":    float64(seconds),
		"resolution": VeoResolutionRatio(modelName, resolution),
		"audio": VeoAudioRatio(
			modelName,
			resolution,
			ResolveVeoGenerateAudio(req.Metadata),
		),
	}
}
