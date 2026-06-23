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
// Extract the last runnable Python code block from an assistant markdown
// message. We use the last block because models commonly explain, then end
// with the final runnable script. Returns null when there is no python block.
export function extractRunnableCode(markdown: string): string | null {
  if (!markdown) return null
  const fence = /```(?:python|py)[^\n]*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = fence.exec(markdown)) !== null) {
    last = match[1]
  }
  return last && last.trim() ? last.trim() : null
}

// Remove the runnable (last) Python block so the chat can show only the
// assistant's prose and move the code into the collapsible run panel. Any
// earlier code blocks are kept.
export function stripRunnableCode(markdown: string): string {
  if (!markdown) return markdown
  const fence = /```(?:python|py)[^\n]*\n[\s\S]*?```/gi
  const matches = [...markdown.matchAll(fence)]
  if (matches.length === 0) return markdown
  const last = matches[matches.length - 1]
  const start = last.index ?? 0
  return (
    markdown.slice(0, start) + markdown.slice(start + last[0].length)
  ).trim()
}
