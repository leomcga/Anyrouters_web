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
// Dynamic font subsetting via HarfBuzz (compiled to WebAssembly).
//
// Why this exists: pdf-lib embeds fonts fine but its built-in glyph subsetter
// (fontkit) corrupts/drops glyphs on large CJK fonts. So we do the subsetting
// ourselves with HarfBuzz — the same engine Google Fonts uses — which produces
// a correct, tiny font containing ONLY the characters a given PDF actually
// uses. That subset is then embedded with pdf-lib `subset:false` (no further
// subsetting), which renders 100% correctly.
//
// Result: full character coverage (even rare hanzi) AND a tiny PDF (a few KB of
// font per document), instead of choosing between "common charset only" or
// "embed the whole 10MB font".
//
// The .wasm is fetched from /harfbuzz-subset.wasm on first use (never bundled).

// HarfBuzz subset "sets" enum: which table-tag set to address.
const HB_SUBSET_SETS_DROP_TABLE_TAG = 4

interface HbExports {
  memory: WebAssembly.Memory
  malloc(n: number): number
  free(p: number): void
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number
  ): number
  hb_blob_destroy(blob: number): void
  hb_blob_get_data(blob: number, length: number): number
  hb_blob_get_length(blob: number): number
  hb_face_create(blob: number, index: number): number
  hb_face_destroy(face: number): void
  hb_face_reference_blob(face: number): number
  hb_subset_input_create_or_fail(): number
  hb_subset_input_destroy(input: number): void
  hb_subset_input_unicode_set(input: number): number
  hb_subset_input_set(input: number, setType: number): number
  hb_subset_or_fail(face: number, input: number): number
  hb_set_add(set: number, codepoint: number): void
}

let hbPromise: Promise<HbExports> | null = null

async function loadHb(): Promise<HbExports> {
  if (hbPromise) return hbPromise
  hbPromise = (async () => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
    const res = await fetch(`${base}/harfbuzz-subset.wasm`)
    if (!res.ok) throw new Error('harfbuzz wasm load failed')
    const bytes = await res.arrayBuffer()
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return instance.exports as unknown as HbExports
  })()
  return hbPromise
}

function tag(s: string): number {
  return (
    ((s.charCodeAt(0) << 24) |
      (s.charCodeAt(1) << 16) |
      (s.charCodeAt(2) << 8) |
      s.charCodeAt(3)) >>>
    0
  )
}

/**
 * Subset `fontBytes` down to only the glyphs needed for `text`. Returns a small
 * font (TTF) that can be embedded with pdf-lib `subset:false`. Layout tables
 * (GSUB/GPOS/GDEF) are dropped — PDF text drawing does its own positioning and
 * fontkit chokes on subset layout tables — which is safe for our use.
 */
export async function subsetFontForText(
  fontBytes: ArrayBuffer | Uint8Array,
  text: string
): Promise<Uint8Array> {
  const hb = await loadHb()
  const src =
    fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes)

  const fontPtr = hb.malloc(src.byteLength)
  new Uint8Array(hb.memory.buffer).set(src, fontPtr)
  const blob = hb.hb_blob_create(fontPtr, src.byteLength, 2 /* writable */, 0, 0)
  const face = hb.hb_face_create(blob, 0)
  const input = hb.hb_subset_input_create_or_fail()

  try {
    if (input === 0) throw new Error('hb_subset_input_create_or_fail failed')

    // Retain glyphs for every unique code point in the text (always include the
    // space + basic ASCII fallbacks so partial text still lays out).
    const unicodeSet = hb.hb_subset_input_unicode_set(input)
    const chars = new Set<number>()
    for (const ch of text) chars.add(ch.codePointAt(0)!)
    chars.add(0x20) // space
    for (const cp of chars) hb.hb_set_add(unicodeSet, cp)

    // Drop OpenType layout tables so pdf-lib's fontkit doesn't crash on them.
    const dropSet = hb.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG)
    for (const t of ['GSUB', 'GPOS', 'GDEF']) hb.hb_set_add(dropSet, tag(t))

    const subsetFace = hb.hb_subset_or_fail(face, input)
    if (subsetFace === 0) throw new Error('hb_subset_or_fail returned null')

    const resultBlob = hb.hb_face_reference_blob(subsetFace)
    const offset = hb.hb_blob_get_data(resultBlob, 0)
    const len = hb.hb_blob_get_length(resultBlob)
    // Copy out of wasm memory before we free anything.
    const out = new Uint8Array(hb.memory.buffer).slice(offset, offset + len)

    hb.hb_blob_destroy(resultBlob)
    hb.hb_face_destroy(subsetFace)
    return out
  } finally {
    hb.hb_subset_input_destroy(input)
    hb.hb_face_destroy(face)
    hb.hb_blob_destroy(blob)
    hb.free(fontPtr)
  }
}
