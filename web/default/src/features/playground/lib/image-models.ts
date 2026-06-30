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

export type ImageModelKind = 'gemini' | 'openai'

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
  if (m.includes('gpt-image') || m.includes('dall-e') || m.includes('dalle')) {
    return 'openai'
  }
  if (m.includes('gemini')) return 'gemini'
  return null
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
// (gemini-*-flash-image) top out at 2K; 4K is a Pro-image-only tier, so it's not
// offered for the flash models the playground currently exposes.
export const IMAGE_RESOLUTIONS = ['1K', '2K'] as const
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number]

export interface ImageGenOptions {
  aspectRatio: AspectRatio
  // gpt-image-2 only.
  quality: ImageQuality
  // Gemini image models only.
  resolution: ImageResolution
}

export const DEFAULT_IMAGE_OPTIONS: ImageGenOptions = {
  aspectRatio: 'auto',
  quality: 'high',
  resolution: '1K',
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
