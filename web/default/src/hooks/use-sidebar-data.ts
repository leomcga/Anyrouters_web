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
import {
  BookOpen,
  Box,
  Boxes,
  Briefcase,
  CreditCard,
  Key,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Radio,
  ReceiptText,
  Settings,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type SidebarData } from '@/components/layout/types'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()

  return {
    navGroups: [
      {
        id: 'common',
        title: t('Frequently Used'),
        items: [
          {
            title: t('Wallet Top-up'),
            url: '/wallet',
            icon: Wallet,
          },
          {
            title: t('Dashboard'),
            url: '/dashboard',
            icon: LayoutDashboard,
          },
          {
            title: t('Settings'),
            url: '/profile',
            icon: Settings,
          },
          {
            // Email support: opens the user's mail app pre-addressed to the
            // support inbox. The old link went to the FreeScout AGENT login
            // (support.anyrouters.com/login), a dead end for real users who
            // have no staff account (2026-07-03).
            title: t('Contact Support'),
            url: 'mailto:1711393695@qq.com?subject=AnyRouters%20%E5%B7%A5%E5%8D%95%E5%92%A8%E8%AF%A2',
            icon: LifeBuoy,
            external: true,
          },
        ],
      },
      {
        id: 'workspace',
        title: t('Workspace'),
        items: [
          {
            title: t('Chat'),
            url: '/playground',
            icon: MessageSquare,
          },
        ],
      },
      {
        id: 'api',
        title: t('API Configuration'),
        items: [
          {
            title: t('Model Marketplace'),
            url: '/marketplace',
            icon: Boxes,
          },
          {
            title: t('Create API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage Details'),
            url: '/usage-logs/common',
            icon: ReceiptText,
          },
          {
            title: t('Documentation'),
            url: '/docs',
            icon: BookOpen,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('B2B Customers'),
            url: '/btob',
            icon: Briefcase,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Subscription Management'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
          },
        ],
      },
    ],
  }
}
