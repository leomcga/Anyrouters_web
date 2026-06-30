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
'use client'

import { Fragment, type ComponentProps, memo, useState, useEffect } from 'react'
import { Download, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'
import { getImage, isIdbImageRef } from '@/features/playground/lib/image-store'
import {
  getVideoUrl,
  isIdbVideoRef,
} from '@/features/playground/lib/video-store'
import {
  canEditImage,
  requestEditImage,
} from '@/features/playground/lib/image-edit-bridge'

type ResponseProps = ComponentProps<typeof Streamdown>

// A generated image rendered ourselves (Streamdown blocks data: URIs) plus a
// hover download button. The src may be a base64 data URI (live session) or an
// `idbimg://<id>` reference (persisted history) — the latter is resolved back
// from local IndexedDB on mount.
function GeneratedImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation()
  const [resolved, setResolved] = useState<string | null>(
    isIdbImageRef(src) ? null : src
  )
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let active = true
    if (isIdbImageRef(src)) {
      setResolved(null)
      setMissing(false)
      getImage(src).then((url) => {
        if (!active) return
        if (url) setResolved(url)
        else setMissing(true)
      })
    } else {
      setResolved(src)
    }
    return () => {
      active = false
    }
  }, [src])

  if (missing) {
    return (
      <span className='text-muted-foreground my-2 inline-block text-sm'>
        {t('Image expired')}
      </span>
    )
  }
  if (!resolved) {
    return (
      <span className='text-muted-foreground my-2 inline-block text-sm'>
        {t('Loading image…')}
      </span>
    )
  }

  return (
    <span className='group/img relative my-2 inline-block max-w-full align-top'>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={alt}
        // !-prefixed so the surrounding prose styles (which force img width:100%)
        // don't stretch the picture: keep the real aspect ratio, cap height so
        // portrait (9:16) images stay tall instead of being squashed to full width.
        className='!my-0 !h-auto !w-auto !max-h-[28rem] !max-w-full rounded-lg border object-contain'
      />
      {/* Always-visible image action bar (top-right). A generated image is its
          own thing — its controls live here, not in the text message action bar,
          so they don't collide with Copy/Edit/Regenerate for text. */}
      <span className='absolute right-2 top-2 flex items-center gap-1'>
        {/* Edit this image (multi-turn editing) — only when the playground has
            registered a handler. Sends the picture back to the image model with
            the user's next instruction. */}
        {canEditImage() && (
          <button
            type='button'
            onClick={() => requestEditImage(resolved)}
            className='bg-background/90 text-foreground hover:bg-background flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium shadow-sm backdrop-blur'
            title={t('Edit image')}
          >
            <Wand2 className='size-3.5' />
            <span>{t('Edit image')}</span>
          </button>
        )}
        <a
          href={resolved}
          download={`${(alt || 'image').replace(/[^\w-]+/g, '_').slice(0, 40)}.png`}
          className='bg-background/90 text-foreground hover:bg-background flex items-center gap-1 rounded-md border px-2 py-1 text-xs shadow-sm backdrop-blur'
          title={t('Download image')}
        >
          <Download className='size-3.5' />
        </a>
      </span>
      {/* Quiet, one-time notice: generated images are kept only in the browser
          (most recent 100), so anything worth keeping should be downloaded. */}
      <span className='text-muted-foreground mt-1 block text-[11px]'>
        {t('Images are kept locally (latest 100) — download ones you want to keep.')}
      </span>
    </span>
  )
}

// A generated video (Veo). Rendered as a native <video> player with controls
// plus a download link. The src is either an `idbvid://<id>` reference (mp4
// bytes persisted in IndexedDB, the normal case — survives refresh) or, as a
// fallback, the live content proxy (/v1/videos/<id>/content).
function GeneratedVideo({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation()
  const [resolved, setResolved] = useState<string | null>(
    isIdbVideoRef(src) ? null : src
  )
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    if (isIdbVideoRef(src)) {
      setResolved(null)
      setMissing(false)
      getVideoUrl(src).then((url) => {
        if (!active) {
          if (url) URL.revokeObjectURL(url)
          return
        }
        if (url) {
          objectUrl = url
          setResolved(url)
        } else {
          setMissing(true)
        }
      })
    } else {
      setResolved(src)
    }
    return () => {
      active = false
      // Reclaim the object URL when this player unmounts.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  if (missing) {
    return (
      <span className='text-muted-foreground my-2 inline-block text-sm'>
        {t('Video expired')}
      </span>
    )
  }
  if (!resolved) {
    return (
      <span className='text-muted-foreground my-2 inline-block text-sm'>
        {t('Loading video…')}
      </span>
    )
  }

  return (
    <span className='group/vid relative my-2 block max-w-full'>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={resolved}
        controls
        playsInline
        className='max-h-[480px] max-w-full rounded-lg border'
      />
      <span className='absolute right-2 top-2 flex items-center gap-1'>
        <a
          href={resolved}
          download={`${(alt || 'video').replace(/[^\w-]+/g, '_').slice(0, 40)}.mp4`}
          className='bg-background/90 text-foreground hover:bg-background flex items-center gap-1 rounded-md border px-2 py-1 text-xs shadow-sm backdrop-blur'
          title={t('Download video')}
        >
          <Download className='size-3.5' />
        </a>
      </span>
      <span className='text-muted-foreground mt-1 block text-[11px]'>
        {t('Videos are kept locally (latest 20) — download ones you want to keep.')}
      </span>
    </span>
  )
}

const stripCustomTags = (input: unknown): unknown => {
  if (typeof input !== 'string') return input
  return (
    input
      // Remove known AI custom wrapper tags but keep inner content
      .replace(
        /<\/?(conversation|conversationcontent|reasoning|reasoningcontent|reasoningtrigger|sources|sourcescontent|sourcestrigger|branch|branchmessages|branchnext|branchpage|branchprevious|branchselector|message|messagecontent)\b[^>]*>/gi,
        ''
      )
      // Remove any stray <think> tags if they still appear
      .replace(/<\/?think\b[^>]*>/gi, '')
  )
}

// A generated video we render ourselves as a <video> player. Emitted by the
// playground's Veo flow as `!video[alt](url)` where url is the content proxy
// (/v1/videos/<id>/content, cookie-authenticated) or any direct mp4 URL.
const VIDEO_MD = /!video\[([^\]]*)\]\(([^\s)]+)\)/g

// A *completed* markdown image we render ourselves: either a base64 data URI
// (live session) or an `idbimg://<id>` reference (persisted history, resolved
// from local IndexedDB). e.g. ![alt](data:image/...;base64,...) or ![alt](idbimg://...)
const DATA_IMAGE_MD =
  /!\[([^\]]*)\]\(((?:data:image\/[a-zA-Z0-9.+-]+;base64,|idbimg:\/\/)[^\s)]+)\)/g
// The *start* of such an image that hasn't finished streaming yet (no closing
// paren received). We detect this so we can show a placeholder instead of
// leaking a half-finished base64 blob into Streamdown (which would flash a
// "[Image blocked]" / giant gibberish string mid-stream).
const DATA_IMAGE_MD_PARTIAL = /!\[[^\]]*\]\(data:image\/[a-zA-Z0-9.+-]*;?base64,[^)]*$/

// Why we render base64 images ourselves instead of via Streamdown:
// Streamdown v2's sanitizer hard-blocks `data:` image URIs and renders them as
// the literal text "[Image blocked: ...]" — this is baked into the component and
// cannot be disabled via allowedImagePrefixes / allowDataImages / a custom harden
// plugin (verified: all three still block; see vercel/streamdown#124). Our in-chat
// image generation legitimately returns base64 images, so we split the content on
// data-image links, render those with a plain <img>, and hand only the surrounding
// text to Streamdown — keeping all other markdown (tables, code, …) intact.
function renderWithDataImages(
  text: string,
  renderText: (chunk: string, key: string) => React.ReactNode,
  imagePlaceholder: string
): React.ReactNode {
  VIDEO_MD.lastIndex = 0
  DATA_IMAGE_MD.lastIndex = 0
  const hasVideo = VIDEO_MD.test(text)
  if (
    !hasVideo &&
    !DATA_IMAGE_MD.test(text) &&
    !DATA_IMAGE_MD_PARTIAL.test(text)
  ) {
    return renderText(text, 'all')
  }

  // Scan for both video (!video[..](..)) and image links in document order, so
  // a message can interleave text + media correctly.
  const MEDIA_MD = new RegExp(`${VIDEO_MD.source}|${DATA_IMAGE_MD.source}`, 'g')
  MEDIA_MD.lastIndex = 0
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = MEDIA_MD.exec(text)) !== null) {
    const full = match[0]
    // Groups 1/2 = video alt/url; groups 3/4 = image alt/url.
    const isVideo = match[1] !== undefined || match[2] !== undefined
    const alt = isVideo ? match[1] : match[3]
    const url = isVideo ? match[2] : match[4]
    if (match.index > lastIndex) {
      parts.push(renderText(text.slice(lastIndex, match.index), `t-${i}`))
    }
    parts.push(
      isVideo ? (
        <GeneratedVideo key={`vid-${i}`} src={url} alt={alt || 'generated video'} />
      ) : (
        <GeneratedImage key={`img-${i}`} src={url} alt={alt || 'generated image'} />
      )
    )
    lastIndex = match.index + full.length
    i++
  }

  // Remaining tail after the last completed image.
  const tail = text.slice(lastIndex)
  if (tail) {
    // If an image is still streaming in (opened but not yet closed), don't pass
    // the half base64 to Streamdown — render text before it + a placeholder.
    const partial = tail.match(DATA_IMAGE_MD_PARTIAL)
    if (partial && partial.index !== undefined) {
      if (partial.index > 0) {
        parts.push(renderText(tail.slice(0, partial.index), `t-tail`))
      }
      parts.push(
        <p key='img-loading' className='text-muted-foreground my-2 text-sm'>
          {imagePlaceholder}
        </p>
      )
    } else {
      parts.push(renderText(tail, `t-tail`))
    }
  }
  return (
    <>
      {parts.map((p, idx) => (
        <Fragment key={idx}>{p}</Fragment>
      ))}
    </>
  )
}

export const Response = memo(
  ({ className, children, ...props }: ResponseProps) => {
    const { t } = useTranslation()
    const safeChildren = stripCustomTags(children)

    const renderText = (chunk: string, key: string) => (
      <Streamdown
        key={key}
        className={cn(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
        {...props}
      >
        {chunk}
      </Streamdown>
    )

    if (typeof safeChildren !== 'string') {
      return renderText(safeChildren as unknown as string, 'all')
    }

    return (
      <>
        {renderWithDataImages(
          safeChildren,
          renderText,
          t('Generating image…')
        )}
      </>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

Response.displayName = 'Response'
