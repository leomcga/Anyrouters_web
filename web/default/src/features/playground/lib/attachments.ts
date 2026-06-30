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
import type { AttachedFile } from '../types'

// Read one file into a base64 data URL (empty string on error).
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

export interface IngestedAttachments {
  // Image data URLs, always usable (image_url).
  images: string[]
  // Document attachments (only populated when the model accepts documents).
  files: AttachedFile[]
  // Number of non-image files rejected because the model can't take documents.
  rejectedDocs: number
}

// Split dropped/picked/pasted files into images vs documents, reading each into
// a base64 data URL. Documents are only kept when `allowDocs` is true; otherwise
// they're counted in `rejectedDocs` so the caller can surface one honest notice
// instead of silently dropping them. Shared by the composer (picker + paste) and
// the page-level drop zone.
export async function readFilesToAttachments(
  incoming: FileList | File[],
  allowDocs: boolean
): Promise<IngestedAttachments> {
  const all = Array.from(incoming)
  const imgFiles = all.filter((f) => f.type.startsWith('image/'))
  const docFiles = all.filter((f) => !f.type.startsWith('image/'))

  const images = (await Promise.all(imgFiles.map(readFileAsDataUrl))).filter(
    Boolean
  )

  let files: AttachedFile[] = []
  let rejectedDocs = 0
  if (docFiles.length) {
    if (!allowDocs) {
      rejectedDocs = docFiles.length
    } else {
      const read = await Promise.all(
        docFiles.map(async (f) => ({
          name: f.name,
          dataUrl: await readFileAsDataUrl(f),
        }))
      )
      files = read.filter((f) => f.dataUrl)
    }
  }

  return { images, files, rejectedDocs }
}
