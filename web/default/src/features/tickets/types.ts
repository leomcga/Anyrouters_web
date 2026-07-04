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
export type TicketStatus = 'open' | 'replied' | 'closed'

export interface TicketMessage {
  id: number
  ticket_id: number
  author_role: 'user' | 'admin'
  author_id: number
  author_name: string
  content: string
  created_at: number
}

export interface Ticket {
  id: number
  user_id: number
  title: string
  status: TicketStatus
  created_at: number
  updated_at: number
  user_unread: boolean
  admin_unread: boolean
  // Present on the admin list: who opened it.
  user_name?: string
  user_code?: string
  messages?: TicketMessage[]
}
