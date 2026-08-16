import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const from = req.nextUrl.searchParams.get('from') // 'YYYY-MM-DD'
  const to = req.nextUrl.searchParams.get('to') // 'YYYY-MM-DD'
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'from / to パラメータが必要です (YYYY-MM-DD)' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('daily_reports')
    .select(`
      *,
      site:sites(id, name, is_asbestos),
      worker:workers(id, source_kind, company_name, worker_name, cbo_company_user_id, cbo_supplier_id, cbo_supplier_staff_id),
      day_yakan:day_yakan_options(id, label),
      work_content:work_content_options(id, label),
      health_type:health_type_options(id, label)
    `)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { site_id, worker_id, work_date, day_yakan_id, over_hour, work_content_id, health_type_id, reporter_cbo_user_id } = body

  if (!site_id || !worker_id || !work_date) {
    return NextResponse.json({ error: 'site_id / worker_id / work_date は必須です' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('daily_reports')
    .insert({
      site_id,
      worker_id,
      work_date,
      day_yakan_id: day_yakan_id ?? null,
      over_hour: over_hour ?? 0,
      work_content_id: work_content_id ?? null,
      health_type_id: health_type_id ?? '106556',
      reporter_cbo_user_id: reporter_cbo_user_id ?? null,
      sync_status: 'local_new',
      created_by: user.id,
      updated_by: user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この作業者・日付の記録はすでに存在します' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
