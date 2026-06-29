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

import { Fragment, type ComponentProps, memo } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'

type ResponseProps = ComponentProps<typeof Streamdown>

// A generated image rendered ourselves (Streamdown blocks data: URIs) plus a
// hover download button, so users can save the picture with one click.
function GeneratedImage({ src, alt }: { src: string; alt: string }) {
  return (
    <span className='group/img relative my-2 inline-block max-w-full align-top'>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        // !-prefixed so the surrounding prose styles (which force img width:100%)
        // don't stretch the picture: keep the real aspect ratio, cap height so
        // portrait (9:16) images stay tall instead of being squashed to full width.
        className='!my-0 !h-auto !w-auto !max-h-[28rem] !max-w-full rounded-lg border object-contain'
      />
      <a
        href={src}
        download={`${(alt || 'image').replace(/[^\w-]+/g, '_').slice(0, 40)}.png`}
        className='bg-background/80 text-foreground absolute right-2 top-2 flex items-center gap-1 rounded-md border px-2 py-1 text-xs opacity-0 backdrop-blur transition-opacity group-hover/img:opacity-100'
        title='下载图片'
      >
        <Download className='size-3.5' />
      </a>
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

// A *completed* markdown image whose URL is a base64 data URI — the output of
// the in-chat image models (Nano Banana / gpt-image-2): ![alt](data:image/...;base64,....)
const DATA_IMAGE_MD = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^\s)]+)\)/g
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
  DATA_IMAGE_MD.lastIndex = 0
  if (!DATA_IMAGE_MD.test(text) && !DATA_IMAGE_MD_PARTIAL.test(text)) {
    return renderText(text, 'all')
  }

  DATA_IMAGE_MD.lastIndex = 0
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = DATA_IMAGE_MD.exec(text)) !== null) {
    const [full, alt, url] = match
    if (match.index > lastIndex) {
      parts.push(renderText(text.slice(lastIndex, match.index), `t-${i}`))
    }
    parts.push(
      <GeneratedImage key={`img-${i}`} src={url} alt={alt || 'generated image'} />
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
