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
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { useSidebarView } from '@/hooks/use-sidebar-view'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { NavGroup } from './nav-group'
import { SidebarViewHeader } from './sidebar-view-header'

/**
 * Desktop-only collapse control — a compact icon button at the top of the
 * sidebar (the label shows on hover). Replaces the trigger that used to sit
 * next to the logo.
 */
function SidebarCollapseToggle() {
  const { t } = useTranslation()
  const { toggleSidebar, state } = useSidebar()
  const expanded = state === 'expanded'
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen
  const label = expanded ? t('Collapse sidebar') : t('Expand sidebar')
  return (
    <button
      type='button'
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
      className='text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-7 items-center justify-center rounded-md transition-colors'
    >
      <Icon className='size-4' />
    </button>
  )
}

/**
 * Application sidebar.
 *
 * Adopts the Vercel / Cloudflare "drill-in" pattern: the URL drives
 * which sidebar *view* is rendered. Clicking a top-level entry like
 * `System Settings` swaps the sidebar to a contextual workspace —
 * with a `← Back to Dashboard` affordance — instead of stacking the
 * sub-navigation inside the root tree.
 *
 * Architecture:
 *   - View resolution + filtering: {@link useSidebarView}
 *   - View registry: `layout/lib/sidebar-view-registry.ts`
 *   - Per-view header: {@link SidebarViewHeader}
 *
 * Adding a new nested view only requires registering a {@link SidebarView}
 * in the registry; this component requires no changes.
 */
export function AppSidebar() {
  const { key, view, navGroups } = useSidebarView()
  const shouldReduce = useReducedMotion()

  // The layout ConfigDrawer is no longer exposed in the console, so pin the
  // sidebar to the intended design (icon-collapsible, inset). This also avoids a
  // stale `layout_collapsible=none` cookie leaving a sidebar that can't collapse.
  return (
    <Sidebar collapsible='icon' variant='inset'>
      <SidebarHeader className='hidden items-end group-data-[collapsible=icon]:items-center md:flex'>
        <SidebarCollapseToggle />
      </SidebarHeader>

      {view && <SidebarViewHeader view={view} />}

      <SidebarContent className='py-2'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={key}
            initial={
              shouldReduce ? false : MOTION_VARIANTS.sidebarSlide.initial
            }
            animate={MOTION_VARIANTS.sidebarSlide.animate}
            exit={shouldReduce ? undefined : MOTION_VARIANTS.sidebarSlide.exit}
            transition={MOTION_TRANSITION.fast}
            className='flex flex-col'
          >
            {navGroups.map((props) => (
              <NavGroup key={props.id || props.title} {...props} />
            ))}
          </motion.div>
        </AnimatePresence>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
