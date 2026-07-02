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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { SectionPageLayout } from '@/components/layout'
import { B2BPricingPanel } from './components/pricing-panel'
import { B2BCustomersPanel } from './components/customers-panel'

// Customer-centric layout: the customer list is the main surface. The overall
// default tier (shared "btob" pricing that new customers inherit) lives in a
// collapsible card on top, collapsed by default so it doesn't distract from the
// per-customer workflow but is one click away when you need to tune the default.
export function BtoB() {
  const { t } = useTranslation()
  const [tierOpen, setTierOpen] = useState(false)

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('B2B Customers')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <Collapsible open={tierOpen} onOpenChange={setTierOpen}>
            <CollapsibleTrigger className='hover:bg-muted/50 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left'>
              <div>
                <div className='font-medium'>{t('Overall default tier')}</div>
                <div className='text-muted-foreground text-xs'>
                  {t(
                    'Shared B2B pricing that new customers inherit. Edit affects everyone on this tier.'
                  )}
                </div>
              </div>
              <ChevronDown
                className={`size-4 shrink-0 transition-transform ${
                  tierOpen ? 'rotate-180' : ''
                }`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className='pt-4'>
              <B2BPricingPanel />
            </CollapsibleContent>
          </Collapsible>

          <B2BCustomersPanel />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
