import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { countPushTargets, pushReports, type PushTarget } from '@/lib/cbo/sync-reports'

// 画面遷移でブラウザ側の接続が切れても処理を継続できるよう、対象件数の確認後は
// 即座にレスポンスを返し、実際の反映処理は after() でバックグラウンド実行する。
// （1回のリクエストが長時間化してタイムアウト表示になる問題も併せて解消する）
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteId, ids } = await req.json()
  if (!siteId && !ids?.length) {
    return NextResponse.json({ error: 'siteId または ids のいずれかは必須です' }, { status: 400 })
  }

  const target: PushTarget = siteId ? { siteId } : { ids }

  let accepted: number
  try {
    accepted = await countPushTargets(target)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  if (accepted === 0) return NextResponse.json({ accepted: 0 })

  after(() => pushReports(target, user.id, 'user'))

  return NextResponse.json({ accepted })
}
