/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { TopupRecord } from '../types'

export interface BillingHistoryDisplayValues {
  amountUsd: number
  paymentUsd: number | null
}

/**
 * Historical redemption orders store quota units in `amount` and the credited
 * USD value in `money`. Ordinary online orders store USD values in both fields.
 * Normalize at display time so every existing redemption row is fixed without
 * rewriting authoritative order history.
 */
export function getBillingHistoryDisplayValues(
  record: Pick<TopupRecord, 'amount' | 'money' | 'payment_method' | 'trade_no'>
): BillingHistoryDisplayValues {
  const isRedemption =
    record.payment_method === 'redemption' ||
    record.trade_no.startsWith('redeem-')

  if (isRedemption) {
    return {
      amountUsd: record.money,
      paymentUsd: null,
    }
  }

  return {
    amountUsd: record.amount,
    paymentUsd: record.money,
  }
}
