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
 * LobeHub Icon Loader
 * Dynamically load and render icons from @lobehub/icons
 *
 * Supports:
 * - Basic: "OpenAI", "OpenAI.Color"
 * - Chained properties: "OpenAI.Avatar.type={'platform'}"
 * - Size parameter: getLobeIcon("OpenAI", 20)
 */
/* eslint-disable react-refresh/only-export-components -- this shared factory intentionally returns React nodes */
import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'

type IconProps = Record<string, string | number | boolean>
type CompoundedIcon = ComponentType<IconProps> & Record<string, unknown>

interface AsyncLobeIconProps {
  fallback: ReactNode
  iconProps: IconProps
  variant?: string
}

interface LazyIconContext {
  (request: string): Promise<{ default: unknown }>
  keys(): string[]
}

declare const require: {
  context(
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp,
    mode: 'lazy'
  ): LazyIconContext
}

const iconModules = require.context(
  '@lobehub/icons/es',
  true,
  /^\.\/[A-Za-z][A-Za-z0-9]*\/index\.js$/,
  'lazy'
)
const availableIconModules = new Set(iconModules.keys())

const iconModuleCache = new Map<
  string,
  LazyExoticComponent<ComponentType<AsyncLobeIconProps>>
>()

function IconFallback(props: { iconName?: string; size: number }) {
  const firstLetter = props.iconName?.charAt(0).toUpperCase() || '?'

  return (
    <div
      className='bg-muted text-muted-foreground flex items-center justify-center rounded-full text-xs font-medium'
      style={{ width: props.size, height: props.size }}
    >
      {firstLetter}
    </div>
  )
}

function isIconComponent(value: unknown): value is ComponentType<IconProps> {
  return typeof value === 'function' || typeof value === 'object'
}

function getLazyIconModule(
  baseKey: string
): LazyExoticComponent<ComponentType<AsyncLobeIconProps>> {
  const cached = iconModuleCache.get(baseKey)
  if (cached) return cached

  const iconModule = lazy(async () => {
    try {
      const modulePath = `./${baseKey}/index.js`
      if (!availableIconModules.has(modulePath)) throw new Error('Unknown icon')

      const module = await iconModules(modulePath)
      const BaseIcon = module.default as CompoundedIcon

      return {
        default: function LoadedLobeIcon(props: AsyncLobeIconProps) {
          const variant = props.variant ? BaseIcon[props.variant] : undefined
          const IconComponent = isIconComponent(variant) ? variant : BaseIcon

          return isIconComponent(IconComponent) ? (
            <IconComponent {...props.iconProps} />
          ) : (
            props.fallback
          )
        },
      }
    } catch {
      return {
        default: function MissingLobeIcon(props: AsyncLobeIconProps) {
          return props.fallback
        },
      }
    }
  })

  iconModuleCache.set(baseKey, iconModule)
  return iconModule
}

/**
 * Parse a property value from string to appropriate type
 * @param raw - Raw string value
 * @returns Parsed value (boolean, number, or string)
 */
function parseValue(raw: string | undefined | null): string | number | boolean {
  if (raw == null) return true

  let v = String(raw).trim()

  // Remove curly braces
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1).trim()
  }

  // Remove quotes
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1)
  }

  // Boolean
  if (v === 'true') return true
  if (v === 'false') return false

  // Number
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v)

  // Return as string
  return v
}

/**
 * Get LobeHub icon component by name
 * @param iconName - Icon name/description (e.g., "OpenAI", "OpenAI.Color", "Claude.Avatar")
 * @param size - Icon size (default: 20)
 * @returns Icon component or fallback
 *
 * @example
 * getLobeIcon("OpenAI", 24)
 * getLobeIcon("OpenAI.Color", 20)
 * getLobeIcon("Claude.Avatar.type={'platform'}", 32)
 */
export function getLobeIcon(
  iconName: string | undefined | null,
  size: number = 20
): ReactNode {
  if (!iconName || typeof iconName !== 'string') {
    return <IconFallback size={size} />
  }

  const trimmedName = iconName.trim()
  if (!trimmedName) {
    return <IconFallback size={size} />
  }

  // Parse component path and chained properties
  const segments = trimmedName.split('.')
  const baseKey = segments[0]
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(baseKey)) {
    return <IconFallback iconName={trimmedName} size={size} />
  }

  const variant =
    segments.length > 1 && /^[A-Z]/.test(segments[1]) ? segments[1] : undefined
  const propStartIndex = variant ? 2 : 1

  // Parse chained properties (e.g., "type={'platform'}", "shape='square'")
  const props: IconProps = {}

  for (let i = propStartIndex; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue

    const eqIdx = seg.indexOf('=')
    if (eqIdx === -1) {
      props[seg.trim()] = true
      continue
    }

    const key = seg.slice(0, eqIdx).trim()
    const valRaw = seg.slice(eqIdx + 1).trim()
    props[key] = parseValue(valRaw)
  }

  // Set size if not explicitly specified in the string
  if (props.size == null && size != null) {
    props.size = size
  }

  const LazyIcon = getLazyIconModule(baseKey)
  const fallback = <IconFallback iconName={trimmedName} size={size} />

  return (
    <Suspense fallback={fallback}>
      <LazyIcon variant={variant} iconProps={props} fallback={fallback} />
    </Suspense>
  )
}
