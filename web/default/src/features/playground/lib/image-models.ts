/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// Image-generation model detection + the in-chat "generation options" (aspect
// ratio / quality) plumbing. Two model families behave very differently:
//
//  - Gemini image models (e.g. gemini-3.1-flash-image / "Nano Banana") generate
//    INSIDE the chat/completions stream. They take an aspect_ratio via
//    extra_body.google.image_config — there's no size/quality knob.
//  - OpenAI image models (gpt-image-2, dall-e-*) ONLY work on the dedicated
//    /images/generations endpoint (they reject chat/completions outright), and
//    take a discrete `size` + `quality`. The playground reaches that endpoint via
//    the cookie-authenticated /pg/images/generations relay.
//
// The composer shows a generation-options bar only for image models, and shows
// the quality control only for the OpenAI family.

export type ImageModelKind = 'gemini' | 'openai' | 'video'

// Matches the image/video families the gateway exposes. Mirrors the negation in
// payload-builder.ts:isTextModel so the two stay consistent.
const IMAGE_MODEL_RE =
  /image|imagen|veo|sora|dall|flux|midjourney|stable-?diffusion/

export function isImageGenModel(model: string): boolean {
  return IMAGE_MODEL_RE.test(model.toLowerCase())
}

// Whether a model accepts non-image document input (PDF/text) as `file` content
// parts. The gateway forwards these to Claude (→ document block) and GPT-5.x
// (file input). Image/video generation models and embedding-style models do not
// take documents, so the composer hides document attachment for them. We allow
// the mainstream chat families and exclude image-gen models.
export function supportsDocumentInput(model: string): boolean {
  const m = model.toLowerCase()
  if (isImageGenModel(m)) return false
  return /claude|gpt|chatgpt|o\d|gemini|deepseek|grok|qwen|glm|moonshot|kimi|doubao|llama|mistral/.test(
    m
  )
}

// Which generation path a model uses, or null for a plain text/chat model.
// Unknown image models (no dedicated handling) return null so they fall back to
// the normal chat path rather than guessing an incompatible endpoint.
export function imageModelKind(model: string): ImageModelKind | null {
  const m = model.toLowerCase()
  if (!isImageGenModel(m)) return null
  // Video models (Veo, Sora) use the async submit+poll video pipeline.
  if (/veo|sora/.test(m)) return 'video'
  if (m.includes('gpt-image') || m.includes('dall-e') || m.includes('dalle')) {
    return 'openai'
  }
  if (m.includes('gemini')) return 'gemini'
  return null
}

// Whether a model is a video-generation model (Veo). Convenience wrapper.
export function isVideoGenModel(model: string): boolean {
  return imageModelKind(model) === 'video'
}

// Whether this is the Nano Banana Pro generation (gemini-3-pro-image), which
// unlocks the 4K resolution tier the flash models don't have.
export function isProImageModel(model: string): boolean {
  return /gemini-3-pro-image/.test(model.toLowerCase())
}

// Whether a Gemini image model exposes a resolution tier (image_size).
// Only the Nano Banana 2 generation (gemini-3.1-flash-image and later) and
// Nano Banana Pro (gemini-3-pro-image) do; the older gemini-2.5-flash-image
// has a single price/size, and Nano Banana 2 Lite (gemini-3.1-flash-lite-image)
// only outputs 1K — so showing a resolution pill for either would be a fake
// option.
export function supportsResolution(model: string): boolean {
  const m = model.toLowerCase()
  if (/flash-lite-image/.test(m)) return false // Lite: 1K only, no tier
  return (
    m.includes('gemini') &&
    m.includes('image') &&
    (/gemini-3-pro-image/.test(m) || /gemini-3\.\d.*image/.test(m))
  )
}

// Whether a Gemini image model can output 4K. Verified live: BOTH Nano Banana
// Pro (gemini-3-pro-image) AND Nano Banana 2 (gemini-3.1-flash-image) return a
// real 4096×4096 image at image_size "4K". Only the Lite tier is capped lower.
export function supports4K(model: string): boolean {
  const m = model.toLowerCase()
  if (/flash-lite/.test(m)) return false
  return /gemini-3-pro-image/.test(m) || /gemini-3\.\d.*image/.test(m)
}

// Resolution tiers offered for a given Gemini image model. The 3.x generation
// (Pro AND flash) supports 1K/2K/4K; older/lite models top out lower.
export function resolutionsForModel(model: string): readonly ImageResolution[] {
  return supports4K(model) ? IMAGE_RESOLUTIONS_PRO : IMAGE_RESOLUTIONS
}

// Aspect ratios offered in the composer. 'auto' = let the model decide (so the
// user can just describe the proportions in the prompt); the rest are common
// fixed ratios. Both families support these — mapped to each family's native
// parameter below.
export const ASPECT_RATIOS = [
  'auto',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

// gpt-image-2 quality tiers — the OpenAI image API's native low/medium/high
// (verified against the live endpoint). Big price spread, so all three are
// offered (1024²: low ≈ $0.006 / medium ≈ $0.053 / high ≈ $0.211 before the
// gateway's discount).
export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]

// Gemini image-model resolutions — Google's image_size. The flash image models
// (gemini-*-flash-image) top out at 2K; Nano Banana Pro (gemini-3-pro-image)
// adds a 4K tier. Use resolutionsForModel() to pick the right list per model.
export const IMAGE_RESOLUTIONS = ['1K', '2K'] as const
export const IMAGE_RESOLUTIONS_PRO = ['1K', '2K', '4K'] as const
export type ImageResolution = '1K' | '2K' | '4K'

// How many images to generate in one go. gpt-image-2 uses the native `n`
// parameter; Gemini image models take `n` on the chat request too (verified:
// the gateway returns N images in the reply, which render as N separate
// downloadable pictures). 1/2/4 keeps the cost obvious.
export const IMAGE_COUNTS = [1, 2, 4] as const
export type ImageCount = (typeof IMAGE_COUNTS)[number]

export interface ImageGenOptions {
  aspectRatio: AspectRatio
  // gpt-image-2 only.
  quality: ImageQuality
  // Gemini image models only.
  resolution: ImageResolution
  // Both families: number of images to generate at once.
  count: ImageCount
}

// —— Video (Veo) generation options ——
// Veo 3.x supports 4/6/8-second clips, 16:9 or 9:16, 720p or 1080p, with native
// audio. Defaults are the cheapest sensible combo (see DEFAULT_VIDEO_OPTIONS).
export const VIDEO_DURATIONS = [4, 6, 8] as const
export type VideoDuration = (typeof VIDEO_DURATIONS)[number]

export const VIDEO_RESOLUTIONS = ['720p', '1080p', '4k'] as const
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

// Veo's two output shapes the playground offers.
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'] as const
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]

export interface VideoGenOptions {
  duration: VideoDuration
  resolution: VideoResolution
  aspectRatio: VideoAspectRatio
  audio: boolean
}

export const DEFAULT_VIDEO_OPTIONS: VideoGenOptions = {
  duration: 8,
  resolution: '720p',
  aspectRatio: '16:9',
  audio: true,
}

// —— Per-model Veo capabilities (verified against Google's official docs) ——
// All Veo models: 4/6/8s, 16:9 or 9:16, 24fps, mp4, native audio. They differ
// only in resolution: the Fast tier adds 4K; standard 3.1 GA and Veo 3 top out
// at 1080p. And 1080p/4K only support an 8-second clip (720p allows 4/6/8).

// Which resolutions a given Veo model can output.
export function videoResolutionsForModel(
  model: string
): readonly VideoResolution[] {
  const m = model.toLowerCase()
  // Only the Fast tier exposes 4K on our channel (verified live); the GA
  // standard veo-3.1-generate-001 and Veo 3 are 720p/1080p only.
  if (/veo-?3\.1-fast/.test(m) || (/veo/.test(m) && /fast/.test(m))) {
    return ['720p', '1080p', '4k']
  }
  return ['720p', '1080p']
}

// Which clip durations are valid at a given resolution. 1080p and 4K are
// 8-seconds-only; 720p allows 4/6/8.
export function videoDurationsForResolution(
  resolution: VideoResolution
): readonly VideoDuration[] {
  return resolution === '720p' ? [4, 6, 8] : [8]
}

// Map a video aspect ratio + resolution to a representative WxH "size" string.
// The backend derives aspectRatio/resolution from metadata first, but sending
// size too is a harmless, explicit fallback.
export function videoAspectToSize(
  ratio: VideoAspectRatio,
  resolution: VideoResolution
): string {
  const portrait = ratio === '9:16'
  const dims: Record<VideoResolution, [number, number]> = {
    '720p': [1280, 720],
    '1080p': [1920, 1080],
    '4k': [3840, 2160],
  }
  const [w, h] = dims[resolution] ?? dims['720p']
  return portrait ? `${h}x${w}` : `${w}x${h}`
}

export const DEFAULT_IMAGE_OPTIONS: ImageGenOptions = {
  aspectRatio: 'auto',
  quality: 'high',
  resolution: '1K',
  count: 1,
}

// gpt-image-2 sizes (verified against the live endpoint): 1024x1024,
// 1536x1024 (landscape), 1024x1536 (portrait), or "auto" (model picks, honoring
// any proportions described in the prompt). Map each aspect ratio accordingly.
export function aspectRatioToOpenAISize(ratio: AspectRatio): string {
  switch (ratio) {
    case 'auto':
      return 'auto'
    case '16:9':
    case '4:3':
      return '1536x1024'
    case '9:16':
    case '3:4':
      return '1024x1536'
    case '1:1':
    default:
      return '1024x1024'
  }
}

// Gemini's aspect_ratio for the chat extra_body, or null when 'auto' (omit the
// param so the model freely follows the prompt's described proportions).
export function aspectRatioToGemini(ratio: AspectRatio): string | null {
  return ratio === 'auto' ? null : ratio
}

// gpt-image-2 takes the quality value as-is (low/medium/high).
export function qualityToOpenAIQuality(q: ImageQuality): string {
  return q
}
