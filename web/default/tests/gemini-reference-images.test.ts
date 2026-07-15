import { describe, expect, test } from 'bun:test'
import { prepareGeminiReferenceImages } from '../src/features/playground/lib/gemini-reference-images'

const dataUrl = (size: number) =>
  `data:image/png;base64,${'a'.repeat(Math.max(0, size - 22))}`

describe('prepareGeminiReferenceImages', () => {
  test('shrinks an oversized 4K reference before it is reused by four requests', async () => {
    let transcodeCalls = 0
    const prepared = await prepareGeminiReferenceImages([dataUrl(180)], {
      maxTotalChars: 80,
      transcode: async () => {
        transcodeCalls++
        return dataUrl(60)
      },
    })

    const payloads = Array.from({ length: 4 }, () => ({ images: prepared }))
    expect(transcodeCalls).toBe(1)
    expect(prepared[0].length).toBeLessThanOrEqual(80)
    expect(payloads).toHaveLength(4)
    expect(payloads.every((payload) => payload.images === prepared)).toBe(true)
  })

  test('budgets multiple references by their combined request size', async () => {
    const prepared = await prepareGeminiReferenceImages(
      [dataUrl(35), dataUrl(120)],
      {
        maxTotalChars: 100,
        transcode: async (_source, maxChars) => dataUrl(maxChars),
      }
    )

    expect(prepared.reduce((sum, image) => sum + image.length, 0)).toBeLessThanOrEqual(
      100
    )
  })

  test('keeps references already inside the safe budget byte-for-byte', async () => {
    const original = dataUrl(60)
    const prepared = await prepareGeminiReferenceImages([original], {
      maxTotalChars: 80,
      transcode: async () => {
        throw new Error('small references must not be transcoded')
      },
    })

    expect(prepared).toEqual([original])
  })
})
