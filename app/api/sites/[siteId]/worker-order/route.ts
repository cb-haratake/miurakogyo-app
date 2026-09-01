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
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('site_worker_orders')
    .select('worker_id, sort_order')
    .eq('site_id', siteId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// body: { ids: string[] } — ドロップ後の新しい順序で並べた同一会社内の作業者ID一覧。
// ids[i] に sort_order = i を割り当てる（会社をまたいでも実害はなく、
// compareWorkers側で同一会社内でしか参照されないため無害）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId } = await params
  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids は必須です' }, { status: 400 })
  }

  const supabase = createServerClient()
  const now = new Date().toISOString()
  const rows = ids.map((workerId: string, index: number) => ({
    site_id: siteId,
    worker_id: workerId,
    sort_order: index,
    updated_at: now,
  }))

  const { error } = await supabase
    .from('site_worker_orders')
    .upsert(rows, { onConflict: 'site_id,worker_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
