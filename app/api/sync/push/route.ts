import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { buildAttendancePayload, createAttendanceReport, updateAttendanceReport } from '@/lib/cbo/reports'

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId, ids } = await req.json()
  if (!siteId && !ids?.length) {
    return NextResponse.json({ error: 'siteId または ids のいずれかは必須です' }, { status: 400 })
  }

  const supabase = createServerClient()
  const pushedAt = new Date().toISOString()

  // 未同期レコードを取得（現場情報はレコードごとにJOINして取得し、複数現場をまたぐpushにも対応する）
  let query = supabase
    .from('daily_reports')
    .select('*, worker:workers(*), site:sites(id, cbo_order_id)')
    .in('sync_status', ['local_new', 'local_edited'])

  if (siteId) query = query.eq('site_id', siteId)
  if (ids?.length) query = query.in('id', ids)

  const { data: reports, error: reportsError } = await query
  if (reportsError) return NextResponse.json({ error: reportsError.message }, { status: 500 })
  if (!reports?.length) return NextResponse.json({ pushed: 0, errors: 0 })

  let pushed = 0
  let errors = 0

  for (const report of reports) {
    const worker = report.worker as Record<string, unknown>
    if (!worker) continue

    const site = report.site as Record<string, unknown> | null
    if (!site?.cbo_order_id) {
      errors++
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: null,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: 現場のCBO連携情報（cbo_order_id）が未設定です`,
        performed_by: user.id, performed_at: pushedAt, trigger_source: 'user',
      })
      continue
    }

    const reporterId = report.reporter_cbo_user_id ?? process.env.CBO_DEFAULT_REPORTER_ID
    if (!reporterId) {
      errors++
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: null,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: reporter_cbo_user_id 未設定 — CBO_DEFAULT_REPORTER_ID を設定してください`,
        performed_by: user.id, performed_at: pushedAt, trigger_source: 'user',
      })
      continue
    }

    try {
      const workerInput =
        worker.source_kind === 'employee'
          ? { kind: 'employee' as const, companyUserId: Number(worker.cbo_company_user_id) }
          : {
              kind: 'partner' as const,
              supplierId: Number(worker.cbo_supplier_id),
              supplierStaffId: Number(worker.cbo_supplier_staff_id),
            }

      const payload = buildAttendancePayload({
        reporterId: Number(reporterId),
        date: report.work_date,
        orderId: Number(site.cbo_order_id),
        worker: workerInput,
        dayYakanId: Number(report.day_yakan_id) || 105360,
        overHour: report.over_hour,
        workContentId: Number(report.work_content_id) || 106548,
        healthTypeId: Number(report.health_type_id) || 106556,
      })

      let cboReportId = report.cbo_report_id

      let cboRawResponse: Record<string, unknown> = {}
      if (report.sync_status === 'local_new') {
        const res = await createAttendanceReport(payload)
        cboReportId = res.cboReportId
        cboRawResponse = res.rawResponse
      } else {
        await updateAttendanceReport(cboReportId!, payload)
      }

      // 成功: synced に更新
      await supabase
        .from('daily_reports')
        .update({
          sync_status: 'synced',
          cbo_report_id: cboReportId,
          cbo_synced_at: pushedAt,
          updated_by: user.id,
        })
        .eq('id', report.id)

      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: cboReportId,
        status: 'success',
        message: `${worker.worker_name}（${report.work_date}）: ${report.sync_status === 'local_new' ? '新規作成' : '更新'}`,
        payload_snapshot: { sent: payload, received: cboRawResponse },
        performed_by: user.id, performed_at: pushedAt, trigger_source: 'user',
      })

      pushed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: report.cbo_report_id,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: ${msg}`,
        payload_snapshot: report,
        performed_by: user.id, performed_at: pushedAt, trigger_source: 'user',
      })
      errors++
    }
  }

  return NextResponse.json({ pushed, errors })
}
