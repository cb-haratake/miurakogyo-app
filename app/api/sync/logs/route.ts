import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const from = params.get('from') // 'YYYY-MM-DD'
  const to = params.get('to') // 'YYYY-MM-DD'
  const direction = params.get('direction') // 'pull' | 'push'
  const target = params.get('target') // 'site' | 'worker' | 'report'
  const status = params.get('status') // 'success' | 'error'
  const triggerSource = params.get('triggerSource') // 'user' | 'cron'
  const q = params.get('q') // メッセージ全文検索
  const limit = Math.min(Number(params.get('limit')) || 100, 500)
  const offset = Number(params.get('offset')) || 0

  const supabase = createServerClient()
  let query = supabase
    .from('sync_logs')
    .select('*', { count: 'exact' })
    .order('performed_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (from) query = query.gte('performed_at', `${from}T00:00:00`)
  if (to) query = query.lte('performed_at', `${to}T23:59:59`)
  if (direction) query = query.eq('direction', direction)
  if (target) query = query.eq('target', target)
  if (status) query = query.eq('status', status)
  if (triggerSource) query = query.eq('trigger_source', triggerSource)
  if (q) query = query.ilike('message', `%${q}%`)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ logs: data, total: count ?? 0 })
}
