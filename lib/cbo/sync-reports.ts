import { createServerClient } from '@/lib/supabase/server'
import { buildAttendancePayload, createAttendanceReport, updateAttendanceReport } from '@/lib/cbo/reports'

export type PushTarget =
  | { siteId: string }
  | { ids: string[] }
  | { all: true; sinceDate: string }

export type PushReportsResult = { pushed: number; errors: number; total: number }

// CBO呼び出しは lib/cbo/client.ts の throttle() で500ms間隔に直列化されるため、
// 並列数を上げても待ち時間の総量は変わらない。バッチ分割は「1回の実行が長時間化して
// タイムアウト・エラー表示になる」ことを避けるための単位（バッチ間で状態を持ち越さず、
// 1バッチ内の失敗が後続バッチを止めない）。
const PUSH_CONCURRENCY = Number(process.env.CBO_PUSH_CONCURRENCY) || 12
const PUSH_BATCH_SIZE = Number(process.env.CBO_PUSH_BATCH_SIZE) || 50

export async function countPushTargets(target: PushTarget): Promise<number> {
  const supabase = createServerClient()
  let query = supabase
    .from('daily_reports')
    .select('id', { count: 'exact', head: true })
    .in('sync_status', ['local_new', 'local_edited'])

  if ('siteId' in target) query = query.eq('site_id', target.siteId)
  if ('ids' in target) query = query.in('id', target.ids)
  if ('all' in target) query = query.gte('work_date', target.sinceDate)

  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function pushReports(
  target: PushTarget,
  userId: string,
  triggerSource: 'user' | 'cron' = 'user'
): Promise<PushReportsResult> {
  const supabase = createServerClient()
  const pushedAt = new Date().toISOString()

  let query = supabase
    .from('daily_reports')
    .select('*, worker:workers(*), site:sites(id, cbo_order_id)')
    .in('sync_status', ['local_new', 'local_edited'])

  if ('siteId' in target) query = query.eq('site_id', target.siteId)
  if ('ids' in target) query = query.in('id', target.ids)
  if ('all' in target) query = query.gte('work_date', target.sinceDate)

  const { data: reportsData, error: reportsError } = await query
  if (reportsError) throw new Error(reportsError.message)
  if (!reportsData?.length) return { pushed: 0, errors: 0, total: 0 }

  let pushed = 0
  let errors = 0

  const pushOne = async (report: (typeof reportsData)[number]) => {
    const worker = report.worker as Record<string, unknown>
    if (!worker) return

    const site = report.site as Record<string, unknown> | null
    if (!site?.cbo_order_id) {
      errors++
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: null,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: 現場のCBO連携情報（cbo_order_id）が未設定です`,
        performed_by: userId, performed_at: pushedAt, trigger_source: triggerSource,
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
        performed_by: userId, performed_at: pushedAt, trigger_source: triggerSource,
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
          updated_by: userId,
        })
        .eq('id', report.id)

      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: cboReportId,
        status: 'success',
        message: `${worker.worker_name}（${report.work_date}）: ${report.sync_status === 'local_new' ? '新規作成' : '更新'}`,
        payload_snapshot: { sent: payload, received: cboRawResponse },
        performed_by: userId, performed_at: pushedAt, trigger_source: triggerSource,
      })

      pushed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase.from('sync_logs').insert({
        direction: 'push', target: 'report',
        record_id: report.id, cbo_report_id: report.cbo_report_id,
        status: 'error', message: `${worker.worker_name}（${report.work_date}）: ${msg}`,
        payload_snapshot: report,
        performed_by: userId, performed_at: pushedAt, trigger_source: triggerSource,
      })
      errors++
    }
  }

  // ワーカープール方式（空いた枠に次のレコードを詰める）でバッチ内を並列実行し、
  // チャンク単位で「一番遅い1件」を待つ方式の待ち合わせロスを避ける。
  // 同時実行数の上限はPUSH_CONCURRENCYで変わらず、CBO側への発信間隔は
  // lib/cbo/client.ts の throttle() が担保する。
  for (let start = 0; start < reportsData.length; start += PUSH_BATCH_SIZE) {
    const batch = reportsData.slice(start, start + PUSH_BATCH_SIZE)
    let cursor = 0
    async function worker() {
      while (true) {
        const index = cursor++
        if (index >= batch.length) return
        await pushOne(batch[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, batch.length) }, () => worker()))
  }

  return { pushed, errors, total: reportsData.length }
}
