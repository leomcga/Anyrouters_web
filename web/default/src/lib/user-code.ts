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
// Stable, human-facing customer code derived from the immutable numeric user
// id. We deliberately do NOT use the login `username` for display: it is an
// identity/credential (often an opaque OIDC-provided string like
// "1711393695_361yph") that must not change. The numeric id is unique,
// sequential and permanent, so formatting it gives every user a clean code for
// the admin console and for customers to quote in support. Not random — no
// collision risk, no extra lookup.

const USER_CODE_PREFIX = 'AR'
const USER_CODE_PAD = 6

/** Format a numeric user id as the platform user code, e.g. 16 -> "AR000016". */
export function formatUserCode(id: number | null | undefined): string {
  if (id == null || !Number.isFinite(id) || id <= 0) return '—'
  return `${USER_CODE_PREFIX}${String(id).padStart(USER_CODE_PAD, '0')}`
}

/**
 * Parse a search term into a numeric user id when it looks like a user code
 * ("AR000016", case-insensitive) or a pure positive integer ("16"). Returns
 * null otherwise, so callers can fall back to a username search. This lets one
 * search box accept the user code, a raw id, or a username.
 */
export function parseUserCode(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const m = s.match(new RegExp(`^${USER_CODE_PREFIX}0*(\\d+)$`, 'i'))
  if (m) {
    const n = Number(m[1])
    return Number.isFinite(n) && n > 0 ? n : null
  }
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}
