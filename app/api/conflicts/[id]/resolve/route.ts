import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'

// action: 'accept_cbo' → synced（CBO版をそのまま使用）
//         'mark_local'  → local_edited（アプリ版として再push）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { action } = await req.json()

  if (action !== 'accept_cbo' && action !== 'mark_local') {
    return NextResponse.json({ error: 'action は accept_cbo か mark_local を指定してください' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('daily_reports')
    .select('id, sync_status')
    .eq('id', id)
    .single()

  if (!existing || existing.sync_status !== 'conflict') {
    return NextResponse.json({ error: '競合レコードが見つかりません' }, { status: 404 })
  }

  const nextStatus = action === 'accept_cbo' ? 'synced' : 'local_edited'

  const { data, error } = await supabase
    .from('daily_reports')
    .update({ sync_status: nextStatus, updated_by: user.id })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('sync_logs').insert({
    direction: 'push',
    target: 'report',
    record_id: id,
    cbo_report_id: existing.id,
    status: 'success',
    message: action === 'accept_cbo' ? '競合解消: CBO版を採用' : '競合解消: アプリ版として再push設定',
    performed_by: user.id, trigger_source: 'user',
  })

  return NextResponse.json(data)
}
