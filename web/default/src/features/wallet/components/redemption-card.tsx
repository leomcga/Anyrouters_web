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
import { Ticket } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface RedemptionCardProps {
  redemptionCode: string
  onRedemptionCodeChange: (value: string) => void
  onRedeem: () => void
  redeeming: boolean
}

/** Bottom-of-wallet module: redeem a code (issued by an admin) into balance.
 *  Wiring (state / hook / api) already lives in the wallet page; this is the
 *  user-facing entry point. */
export function RedemptionCard({
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
}: RedemptionCardProps) {
  const { t } = useTranslation()

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg border'>
            <Ticket className='text-muted-foreground size-4' />
          </div>
          <div className='min-w-0'>
            <h3 className='truncate text-sm font-semibold'>
              {t('Redeem a code')}
            </h3>
            <p className='text-muted-foreground text-xs'>
              {t('Have a redemption code? Enter it to top up your balance.')}
            </p>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Input
            value={redemptionCode}
            onChange={(e) => onRedemptionCodeChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && redemptionCode.trim() && !redeeming) {
                onRedeem()
              }
            }}
            placeholder={t('Enter redemption code')}
            className='h-9 min-w-0 flex-1 font-mono text-sm sm:w-64 sm:flex-none'
          />
          <Button
            onClick={onRedeem}
            disabled={redeeming || !redemptionCode.trim()}
            className='h-9 shrink-0 px-4'
            size='sm'
          >
            {redeeming ? t('Redeeming…') : t('Redeem')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
