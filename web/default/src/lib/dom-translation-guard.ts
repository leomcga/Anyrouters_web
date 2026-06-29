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
 * Make React survive in-browser page translation (Chrome/Google Translate, etc.).
 *
 * Translators rewrite the DOM in place: they wrap or replace our text nodes with
 * their own <font> elements. React still holds a reference to the ORIGINAL node,
 * so when it later updates that subtree and calls `parent.removeChild(oldNode)`
 * (or `insertBefore`), the node is no longer a child of `parent`. The browser
 * then throws:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node':
 *   The node to be removed is not a child of this node.
 *
 * That exception escapes React's commit phase, tears down the whole tree, and the
 * router falls back to the 500 error screen. It is intermittent because it only
 * fires when a translated subtree happens to re-render/unmount (e.g. on /keys
 * while creating an API key). This is the long-standing React issue facebook/
 * react#11538.
 *
 * We do NOT disable translation (that would lock out users who rely on it for a
 * language we don't ship). Instead we make these two DOM mutations defensive — the
 * exact workaround the React core team (gaearon) recommends on that issue, and what
 * Stack Overflow / Remix / many production apps ship. Two layers:
 *   1. a cheap up-front parent check that no-ops the precise translator situation;
 *   2. a try/catch that swallows any remaining NotFoundError as a backstop.
 * In every normal (untranslated) case the parent matches and these are a
 * transparent pass-through, so there is no behavior change.
 *
 * Known trade-off: when we no-op a removeChild, a stale translated TextNode may
 * linger until its parent unmounts (React #11538 has no framework-level fix). That
 * is strictly better than the whole app crashing to the 500 screen, and our own
 * i18n language switcher remains the primary path.
 *
 * Must run before React renders. Imported first in main.tsx.
 */
export function installDomTranslationGuard(): void {
  if (typeof Node !== 'function' || !Node.prototype) return
  // Idempotent: never wrap twice (e.g. HMR, double import).
  const flag = '__domTranslationGuardInstalled'
  const proto = Node.prototype as unknown as Record<string, unknown>
  if (proto[flag]) return
  proto[flag] = true

  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function removeChild<T extends Node>(
    this: Node,
    child: T
  ): T {
    // A translator moved this node under a different parent. Removing it here
    // would throw NotFoundError; React only wants it gone, so treat the
    // already-detached node as successfully removed.
    if (child.parentNode !== this) return child
    try {
      return originalRemoveChild.call(this, child) as T
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return child
      }
      throw error
    }
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null
  ): T {
    // The reference anchor was relocated by a translator. Appending keeps the
    // new node in the tree (correct subtree) instead of throwing NotFoundError.
    if (referenceNode && referenceNode.parentNode !== this) {
      return originalInsertBefore.call(this, newNode, null) as T
    }
    try {
      return originalInsertBefore.call(this, newNode, referenceNode) as T
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return this.appendChild(newNode) as T
      }
      throw error
    }
  }
}
