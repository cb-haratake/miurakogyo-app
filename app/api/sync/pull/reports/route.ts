import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { listAttendanceReports } from '@/lib/cbo/masters'
import { toReportRow } from '@/lib/cbo/normalize'

// 現場によっては出面が数百件になり、1件ずつ詳細APIを呼ぶため時間がかかる
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId, from, to } = await req.json()
  if (!siteId || !from || !to) {
    return NextResponse.json({ error: 'siteId / from / to は必須です' }, { status: 400 })
  }

  const supabase = createServerClient()
  const pulledAt = new Date().toISOString()

  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, name, cbo_order_id')
    .eq('id', siteId)
    .single()

  if (siteError || !site) {
    return NextResponse.json({ error: '現場が見つかりません' }, { status: 404 })
  }

  // 作業者の CBO ID → DB UUID マップを構築（上限を大きく設定して取りこぼし防止）
  const { data: workers } = await supabase
    .from('workers')
    .select('id, source_kind, cbo_company_user_id, cbo_supplier_id, cbo_supplier_staff_id')
    .limit(10000)

  const employeeWorkerMap = new Map(
    (workers ?? [])
      .filter((w) => w.source_kind === 'employee' && w.cbo_company_user_id)
      .map((w) => [w.cbo_company_user_id as string, w.id as string])
  )
  const partnerWorkerMap = new Map(
    (workers ?? [])
      .filter((w) => w.source_kind === 'partner')
      .map((w) => [`${w.cbo_supplier_id}:${w.cbo_supplier_staff_id}`, w.id as string])
  )

  // CBO から出面取得
  let cboReports
  try {
    cboReports = await listAttendanceReports(site.name, { from, to })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('sync_logs').insert({
      direction: 'pull', target: 'report',
      status: 'error', message: `[${site.name}] ${msg}`,
      performed_by: user.id, performed_at: pulledAt, trigger_source: 'user',
    })
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // 既存レコードを取得（cbo_report_id一致での競合検知、および
  // 現場・作業者・日付一致での未紐付けレコードとの突合の両方に使う）
  const { data: existingReports } = await supabase
    .from('daily_reports')
    .select('id, worker_id, work_date, cbo_report_id, sync_status, day_yakan_id, over_hour, work_content_id, health_type_id')
    .eq('site_id', site.id)
    .gte('work_date', from)
    .lte('work_date', to)

  const existingByCboId = new Map(
    (existingReports ?? []).filter((r) => r.cbo_report_id).map((r) => [r.cbo_report_id as string, r])
  )
  const existingByWorkerDate = new Map(
    (existingReports ?? []).map((r) => [`${r.worker_id}:${r.work_date}`, r])
  )

  let upserted = 0
  let conflicts = 0
  const skipReasons: string[] = []
  const rowErrors: string[] = []

  for (const report of cboReports) {
    // worker_id を解決
    let workerId: string | undefined
    if (report.companyUserId) {
      workerId = employeeWorkerMap.get(report.companyUserId)
      if (!workerId) {
        skipReasons.push(`employee companyUserId=${report.companyUserId} not in map`)
      }
    } else if (report.supplierId && report.supplierStaffId) {
      workerId = partnerWorkerMap.get(`${report.supplierId}:${report.supplierStaffId}`)
      if (!workerId) {
        skipReasons.push(`partner supplierId=${report.supplierId} staffId=${report.supplierStaffId} not in map`)
      }
    } else {
      skipReasons.push(`report ${report.cboReportId}: no companyUserId and no supplierId/staffId`)
    }

    if (!workerId) continue

    const existingByCbo = report.cboReportId ? existingByCboId.get(report.cboReportId) : undefined
    const existingByKey = existingByWorkerDate.get(`${workerId}:${report.date}`)

    // cbo_report_id で未紐付けだが、現場・作業者・日付が一致するローカルレコードが既にある場合。
    // CBO側での新規作成を避けるため、内容を上書きせず紐付けのみ行う。
    // 内容が一致しなければ「出面側」を正として競合扱いにし、人による確認（再push）を促す。
    if (!existingByCbo && existingByKey) {
      const pulled = toReportRow(report, site.id, workerId, pulledAt)
      const sameContent =
        existingByKey.day_yakan_id === pulled.day_yakan_id &&
        Number(existingByKey.over_hour) === Number(pulled.over_hour) &&
        existingByKey.work_content_id === pulled.work_content_id &&
        existingByKey.health_type_id === pulled.health_type_id

      const { error } = await supabase
        .from('daily_reports')
        .update({
          cbo_report_id: report.cboReportId,
          cbo_synced_at: pulledAt,
          sync_status: sameContent ? 'synced' : 'conflict',
        })
        .eq('id', existingByKey.id)

      if (error) {
        rowErrors.push(`report ${report.cboReportId}: ${error.message}`)
      } else {
        upserted++
        if (!sameContent) conflicts++
      }
      continue
    }

    const isConflict = existingByCbo?.sync_status === 'local_edited'

    const row = toReportRow(report, site.id, workerId, pulledAt)
    const rowWithStatus = {
      ...row,
      sync_status: isConflict ? ('conflict' as const) : ('synced' as const),
    }

    const { error } = await supabase
      .from('daily_reports')
      .upsert(rowWithStatus, { onConflict: 'cbo_report_id' })

    if (error) {
      rowErrors.push(`report ${report.cboReportId}: ${error.message}`)
    } else {
      upserted++
      if (isConflict) conflicts++
    }
  }

  const skipped = skipReasons.length
  const hasErrors = rowErrors.length > 0
  const msgParts = [
    `${upserted}件取込`,
    conflicts > 0 && `競合${conflicts}件`,
    skipped > 0 && `未解決作業者${skipped}件スキップ`,
    hasErrors && `エラー${rowErrors.length}件`,
  ].filter(Boolean).join('・')

  await supabase.from('sync_logs').insert({
    direction: 'pull', target: 'report',
    status: hasErrors ? 'error' : 'success',
    message: `[${site.name}] ${msgParts}`,
    payload_snapshot: { from, to, skipReasons, rowErrors },
    performed_by: user.id, performed_at: pulledAt, trigger_source: 'user',
  })

  return NextResponse.json({ upserted, conflicts, skipped, skipReasons: skipReasons.slice(0, 5), errors: rowErrors })
}
