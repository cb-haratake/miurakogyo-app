import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { pushReports } from '@/lib/cbo/sync-reports'

// 通常運用ではその日の分だけを反映すればよいが、入力遅れをカバーするため
// 直近7日分を毎日洗い替え対象にする（既にsynced済みのレコードは対象外なので実害はない）
const DEFAULT_WINDOW_DAYS = 7

// CBOのスロットル（500ms/件）×件数分の時間が必要なため上限を延ばす
export const maxDuration = 300

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 導入時の既存バックログ（過去分）を取り込む場合は
  // ?since=YYYY-MM-DD を指定して手動実行する（分割済みのバッチ処理で反映される）
  const since = req.nextUrl.searchParams.get('since') ?? daysAgo(DEFAULT_WINDOW_DAYS)

  const user = await getAuthenticatedUser()
  const result = await pushReports({ all: true, sinceDate: since }, user!.id, 'cron')
  return NextResponse.json(result, { status: result.errors ? 207 : 200 })
}
