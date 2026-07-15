import { describe, expect, test } from 'bun:test'
import { getBillingHistoryDisplayValues } from '../src/features/wallet/lib/billing-display'
import type { TopupRecord } from '../src/features/wallet/types'

function record(overrides: Partial<TopupRecord>): TopupRecord {
  return {
    id: 1,
    user_id: 6,
    amount: 5,
    money: 5,
    trade_no: 'ref_test',
    payment_method: 'stripe',
    create_time: 0,
    status: 'success',
    ...overrides,
  }
}

describe('getBillingHistoryDisplayValues', () => {
  test('normalizes historical $10 redemption orders', () => {
    expect(
      getBillingHistoryDisplayValues(
        record({
          amount: 5_000_000,
          money: 10,
          trade_no: 'redeem-19-16',
          payment_method: 'redemption',
        })
      )
    ).toEqual({ amountUsd: 10, paymentUsd: null })
  })

  test('normalizes all historical $100 redemption orders', () => {
    expect(
      getBillingHistoryDisplayValues(
        record({
          amount: 50_000_000,
          money: 100,
          trade_no: 'redeem-45-6',
          payment_method: 'redemption',
        })
      )
    ).toEqual({ amountUsd: 100, paymentUsd: null })
  })

  test('keeps ordinary online payment values unchanged', () => {
    expect(
      getBillingHistoryDisplayValues(record({ amount: 5, money: 5 }))
    ).toEqual({ amountUsd: 5, paymentUsd: 5 })
  })
})
