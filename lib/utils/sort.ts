import type { WorkerSummary } from '@/types/frontend'

// 会社の並び順: ニチアスセムクリート → 三浦興業 → それ以外（五十音順）
function companyPriority(companyName: string | null | undefined): number {
  const name = companyName ?? ''
  if (name.includes('ニチアス')) return 0
  if (name.includes('三浦興業')) return 1
  return 2
}

export function compareWorkers(
  a: WorkerSummary,
  b: WorkerSummary,
  orderMap?: Map<string, number>
): number {
  const pa = companyPriority(a.company_name)
  const pb = companyPriority(b.company_name)
  if (pa !== pb) return pa - pb
  const co = (a.company_name ?? '').localeCompare(b.company_name ?? '', 'ja')
  if (co !== 0) return co

  // 現場ごとに手動で並び替えた作業者を優先する。両方に手動順があれば数値比較、
  // 片方だけなら手動順ありを先に、両方なければ登録された順→氏名にフォールバック
  const oa = orderMap?.get(a.id)
  const ob = orderMap?.get(b.id)
  if (oa !== undefined && ob !== undefined) return oa - ob
  if (oa !== undefined) return -1
  if (ob !== undefined) return 1

  const ca = a.created_at.localeCompare(b.created_at)
  if (ca !== 0) return ca
  return a.worker_name.localeCompare(b.worker_name, 'ja')
}
