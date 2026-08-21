import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { buildAttendancePayload, createAttendanceReport, updateAttendanceReport } from '@/lib/cbo/reports'

// 件数が多い現場だと1件あたり数秒かかることがあるため、取込側(pull/reports, pull/masters,
// cron/sync-masters)と同様にVercelのデフォルト実行時間制限を緩和する
export const maxDuration = 300

// CBO側の実際の許容レートは未確認のため、まずは控えめな並列数から開始する。
// 429等がsync_logsに出ないか確認しながら環境変数で調整できるようにしておく。
const PUSH_CONCURRENCY = Number(process.env.CBO_PUSH_CONCURRENCY) || 4

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

  const pushOne = async (report: (typeof reports)[number]) => {
    const worker = report.worker as Record<string, unknown>
    if (!worker) return

    const site = report.site as Record<string, unknown> | null
    if (!site?.cbo_order_id) {
      errors++
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: null,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: 現場のCBO連携情報（cbo_order_id）が未設定です`,
        performed_by: user.id, performed_at: pushedAt, trigger_source: 'user',
      })
      return
    }

    // 報告者が未設定の場合、自社員は本人が自己申告したものとみなし本人のCBO IDを使う
    // （CBOから取り込んだ自社員レコードで既に使われているのと同じロジック）。
    // 協力会社はCBO側に本人アカウントがなく自己申告できないため、CBO_DEFAULT_REPORTER_ID が必要。
    const selfReportId = worker.source_kind === 'employee' ? worker.cbo_company_user_id : null
    const reporterId = report.reporter_cbo_user_id ?? selfReportId ?? process.env.CBO_DEFAULT_REPORTER_ID
    if (!reporterId) {
      errors++
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: null,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: reporter_cbo_user_id 未設定 — 協力会社のため自己申告できません。CBO_DEFAULT_REPORTER_ID を設定してください`,
        performed_by: user.id, performed_at: pushedAt, trigger_source: 'user',
      })
      return
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

  // CBO呼び出し自体に数秒かかることがあるため、逐次実行だと件数分だけ直線的に
  // 時間がかかる。件数分をチャンクに分けて並列実行し、待ち時間を重ねる。
  // CBO側への発信間隔は lib/cbo/client.ts の throttle() が担保する。
  for (let i = 0; i < reports.length; i += PUSH_CONCURRENCY) {
    const chunk = reports.slice(i, i + PUSH_CONCURRENCY)
    await Promise.all(chunk.map(pushOne))
  }

  return NextResponse.json({ pushed, errors })
}
