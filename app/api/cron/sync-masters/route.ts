import { NextRequest, NextResponse } from 'next/server'
import { syncMasters } from '@/lib/cbo/sync-masters'

// CBO のスロットル（500ms/件）× 会社数分の時間が必要なため上限を延ばす
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncMasters(null, 'cron')
  return NextResponse.json(result, { status: result.errors.length ? 207 : 200 })
}
