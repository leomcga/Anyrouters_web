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
 * Leaf module (no imports) tracking which assistant message keys have an image
 * generation still running detached from the React tree. Kept separate from the
 * generation manager so both the manager and message-utils can read it without
 * an import cycle (message-utils ← manager ← sessions ← message-utils).
 *
 * Used by sanitizeMessagesOnLoad: a message still LOADING because its detached
 * generation is genuinely in flight must NOT be flipped to "Generation was
 * interrupted" just because the playground remounted (the real complaint —
 * navigating to /wallet mid-generation and back).
 */
const active = new Set<string>()

export function markGenerationActive(messageKey: string): void {
  active.add(messageKey)
}

export function markGenerationDone(messageKey: string): void {
  active.delete(messageKey)
}

export function isGenerationActive(messageKey: string): boolean {
  return active.has(messageKey)
}
