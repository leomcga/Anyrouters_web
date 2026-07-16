/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// Production accepts a ~29 MB image-edit request but rejects one around
// 39.6 MB. Keep the combined base64 reference data well below that boundary so
// prompt/history overhead cannot push a request back over the upstream limit.
// This only changes the reference image sent to Gemini; the requested output
// resolution and output count remain untouched.
export const GEMINI_REFERENCE_IMAGE_BUDGET_CHARS = 12 * 1024 * 1024

type ReferenceImageTranscoder = (
  source: string,
  maxChars: number
) => Promise<string | null>

interface PrepareReferenceImagesOptions {
  maxTotalChars?: number
  transcode?: ReferenceImageTranscoder
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    const header = dataUrl.slice(0, comma)
    const payload = dataUrl.slice(comma + 1)
    const mime = header.match(/^data:([^;,]+)/)?.[1] || 'image/png'
    if (header.includes(';base64')) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new Blob([bytes], { type: mime })
    }
    return new Blob([decodeURIComponent(payload)], { type: mime })
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

async function decodeImage(blob: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Fall through to the broadly supported HTMLImageElement path.
    }
  }

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return null
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('reference image decode failed'))
      image.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch {
    URL.revokeObjectURL(objectUrl)
    return null
  }
}

function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      async (blob) => resolve(blob ? await blobToDataUrl(blob) : null),
      'image/jpeg',
      quality
    )
  })
}

async function transcodeReferenceImage(
  source: string,
  maxChars: number
): Promise<string | null> {
  if (!source.startsWith('data:image/')) return null
  const blob = dataUrlToBlob(source)
  if (!blob) return null
  const decoded = await decodeImage(blob)
  if (!decoded || decoded.width <= 0 || decoded.height <= 0) return null

  try {
    const dimensionLimits = [3072, 2560, 2048, 1600]
    const qualities = [0.84, 0.72, 0.6]
    const triedDimensions = new Set<string>()

    for (const maxDimension of dimensionLimits) {
      const scale = Math.min(
        1,
        maxDimension / Math.max(decoded.width, decoded.height)
      )
      const width = Math.max(1, Math.round(decoded.width * scale))
      const height = Math.max(1, Math.round(decoded.height * scale))
      const dimensionKey = `${width}x${height}`
      if (triedDimensions.has(dimensionKey)) continue
      triedDimensions.add(dimensionKey)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return null
      // JPEG has no alpha channel. A white matte avoids transparent pixels
      // becoming black when an oversized PNG/WebP reference is normalized.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(decoded.source, 0, 0, width, height)

      for (const quality of qualities) {
        const candidate = await canvasToJpegDataUrl(canvas, quality)
        if (candidate && candidate.length <= maxChars) return candidate
      }
    }
    return null
  } finally {
    decoded.release()
  }
}

/**
 * Normalize Gemini image-edit references once before the same reference set is
 * reused by N parallel output requests. Small images stay byte-for-byte
 * identical. Oversized references share one aggregate request budget.
 */
export async function prepareGeminiReferenceImages(
  images: string[],
  options: PrepareReferenceImagesOptions = {}
): Promise<string[]> {
  if (images.length === 0) return images
  const maxTotalChars =
    options.maxTotalChars ?? GEMINI_REFERENCE_IMAGE_BUDGET_CHARS
  if (
    !Number.isFinite(maxTotalChars) ||
    maxTotalChars <= 0 ||
    images.reduce((sum, image) => sum + image.length, 0) <= maxTotalChars
  ) {
    return images
  }

  const maxCharsPerImage = Math.floor(maxTotalChars / images.length)
  const transcode = options.transcode ?? transcodeReferenceImage
  const prepared = await Promise.all(
    images.map(async (image) => {
      if (image.length <= maxCharsPerImage) return image
      const candidate = await transcode(image, maxCharsPerImage)
      if (!candidate || candidate.length > maxCharsPerImage) {
        throw new Error('reference image exceeds safe request budget')
      }
      return candidate
    })
  )

  if (prepared.reduce((sum, image) => sum + image.length, 0) > maxTotalChars) {
    throw new Error('reference images exceed safe combined request budget')
  }
  return prepared
}
