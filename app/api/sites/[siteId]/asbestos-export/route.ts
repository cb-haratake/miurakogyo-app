import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { buildAsbestosWorkbook } from '@/lib/asbestos/build-workbook'
import type { Site } from '@/types/db'
import type { ReportRow } from '@/types/frontend'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId } = await params
  const month = req.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month パラメータが必要です (YYYY-MM)' }, { status: 400 })
  }

  const supabase = createServerClient()

  const [y, m] = month.split('-')
  const from = `${month}-01`
  const to = new Date(Number(y), Number(m), 0).toISOString().slice(0, 10)

  const [{ data: site }, { data: reports }, { data: orderRows }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', siteId).single(),
    supabase
      .from('daily_reports')
      .select(`
        *,
        worker:workers(id, source_kind, company_name, worker_name, cbo_company_user_id, cbo_supplier_id, cbo_supplier_staff_id, created_at),
        day_yakan:day_yakan_options(id, label),
        work_content:work_content_options(id, label),
        health_type:health_type_options(id, label)
      `)
      .eq('site_id', siteId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date')
      .order('worker_id'),
    supabase.from('site_worker_orders').select('worker_id, sort_order').eq('site_id', siteId),
  ])

  if (!site || !reports) {
    return NextResponse.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }

  const workerOrder = new Map((orderRows ?? []).map(r => [r.worker_id, r.sort_order]))

  const buf = await buildAsbestosWorkbook({
    site: site as Site,
    reports: reports as unknown as ReportRow[],
    month,
    workerOrder,
  })

  const fileName = `石綿作業従事者作業記録_${site.name ?? siteId}_${month}.xlsx`

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  })
}
