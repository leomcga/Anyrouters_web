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

// Common aspect ratios offered in the composer. Both families support these as
// labels; we map them to each family's native parameter below.
export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

export type ImageQuality = 'standard' | 'high'

export interface ImageGenOptions {
  aspectRatio: AspectRatio
  quality: ImageQuality
}

export const DEFAULT_IMAGE_OPTIONS: ImageGenOptions = {
  aspectRatio: '1:1',
  quality: 'high',
}

// gpt-image-2 accepts only three discrete sizes (verified against the live
// endpoint): 1024x1024, 1536x1024 (landscape), 1024x1536 (portrait). Map each
// aspect ratio to the closest supported size.
export function aspectRatioToOpenAISize(ratio: AspectRatio): string {
  switch (ratio) {
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

// Our two-step UI quality maps to the API's low/medium/high scale. "standard"
// uses medium (good quality, much cheaper); "high" uses the top tier.
export function qualityToOpenAIQuality(q: ImageQuality): string {
  return q === 'high' ? 'high' : 'medium'
}
