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

/**
 * Bridge for the in-chat "edit this image" action.
 *
 * The chat bubble's <GeneratedImage> lives deep inside the shared, generic
 * Response/markdown renderer, far from the playground's message state. Rather
 * than thread an onEdit prop through every Response consumer, the playground
 * registers a single handler here; GeneratedImage shows its edit button only
 * when a handler is present and calls it with the picture's resolved data URL.
 * This mirrors how GeneratedImage already reaches into image-store directly.
 */
type EditImageHandler = (dataUrl: string) => void

let handler: EditImageHandler | null = null

/** Playground registers (and clears, on unmount) the active edit handler. */
export function setEditImageHandler(fn: EditImageHandler | null): void {
  handler = fn
}

/** Whether image editing is currently available (a handler is registered). */
export function canEditImage(): boolean {
  return handler !== null
}

/** GeneratedImage calls this with the resolved data URL when the user clicks edit. */
export function requestEditImage(dataUrl: string): void {
  handler?.(dataUrl)
}
