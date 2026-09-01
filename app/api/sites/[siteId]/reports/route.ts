import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId } = await params
  const month = req.nextUrl.searchParams.get('month') // 'YYYY-MM'
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month パラメータが必要です (YYYY-MM)' }, { status: 400 })
  }

  const [y, m] = month.split('-')
  const from = `${month}-01`
  const to = new Date(Number(y), Number(m), 0).toISOString().slice(0, 10)

  const supabase = createServerClient()
  const { data, error } = await supabase
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
    .order('worker_id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
