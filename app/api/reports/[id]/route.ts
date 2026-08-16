import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { deleteAttendanceReport } from '@/lib/cbo/reports'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const supabase = createServerClient()

  // 現在の sync_status を取得
  const { data: existing, error: fetchError } = await supabase
    .from('daily_reports')
    .select('id, sync_status')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: '記録が見つかりません' }, { status: 404 })
  }

  // synced → local_edited に遷移。conflict/local_edited はそのまま編集可
  const nextStatus = existing.sync_status === 'synced' ? 'local_edited' : existing.sync_status

  const allowedFields = ['day_yakan_id', 'over_hour', 'work_content_id', 'health_type_id', 'is_corrected']
  const updates: Record<string, unknown> = { sync_status: nextStatus, updated_by: user.id }
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field]
  }

  const { data, error } = await supabase
    .from('daily_reports')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  // 二重確認フラグを要求（石綿記録は40年保存の法定書類）
  if (!body.confirmed) {
    return NextResponse.json({ error: '削除には confirmed: true が必要です' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: existing, error: fetchError } = await supabase
    .from('daily_reports')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: '記録が見つかりません' }, { status: 404 })
  }

  // CBO同期済みの場合はCBO側も削除
  if (existing.cbo_report_id) {
    try {
      await deleteAttendanceReport(existing.cbo_report_id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: id, cbo_report_id: existing.cbo_report_id,
        status: 'error', message: `CBO削除失敗: ${msg}`,
        payload_snapshot: existing,
        performed_by: user.id, trigger_source: 'user',
      })
      return NextResponse.json({ error: `CBO削除に失敗しました: ${msg}` }, { status: 500 })
    }
  }

  // sync_logs に記録してからDB削除
  await supabase.from('sync_logs').insert({
    direction: 'push',
    target: 'report',
    record_id: id,
    cbo_report_id: existing.cbo_report_id,
    status: 'success',
    message: existing.cbo_report_id ? 'CBO・ローカル両方削除' : 'ローカル削除（未同期）',
    payload_snapshot: existing,
    performed_by: user.id, trigger_source: 'user',
  })

  const { error } = await supabase.from('daily_reports').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
