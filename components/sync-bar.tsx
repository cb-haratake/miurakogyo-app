'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

type Props = {
  siteId: string
  month: string
  unsyncedCount: number
  reportsQueryKey: unknown[]
  inline?: boolean
}

export function SyncBar({ siteId, month, unsyncedCount, reportsQueryKey, inline = false }: Props) {
  const qc = useQueryClient()

  const from = `${month}-01`
  // last day of month
  const to = (() => {
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m, 0).toISOString().slice(0, 10)
  })()

  const pull = useMutation({
    mutationFn: () =>
      fetch('/api/sync/pull/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, from, to }),
      }).then(r => r.json()),
    onSuccess: data => {
      const parts = [
        `${data.upserted}件取込`,
        data.conflicts > 0 && `競合${data.conflicts}件`,
        data.skipped > 0 && `未解決${data.skipped}件スキップ`,
      ].filter(Boolean).join('・')
      if (data.errors?.length > 0) {
        toast.warning(`取込完了: ${parts}（エラー${data.errors.length}件）`)
      } else {
        toast.success(`取込完了: ${parts}`)
      }
      qc.invalidateQueries({ queryKey: reportsQueryKey })
    },
    onError: () => toast.error('取込に失敗しました'),
  })

  const push = useMutation({
    mutationFn: () =>
      fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      }).then(r => r.json()),
    onSuccess: data => {
      if (data.error) {
        toast.error(data.error)
      } else if (!data.accepted) {
        toast.info('反映対象がありません')
      } else {
        toast.success(`${data.accepted}件の反映を開始しました。画面を離れても処理は継続され、結果は同期ログでご確認いただけます。`)
      }
    },
    onError: () => toast.error('CBOへの反映に失敗しました'),
  })

  const busy = pull.isPending || push.isPending

  return (
    <div
      className={
        inline
          ? 'flex items-center gap-2 md:gap-3'
          : 'flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200'
      }
    >
      <button
        onClick={() => pull.mutate()}
        disabled={busy}
        className="px-2.5 md:px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
      >
        {pull.isPending ? '取込中...' : 'CBOから取込'}
      </button>

      <button
        onClick={() => push.mutate()}
        disabled={busy || unsyncedCount === 0}
        className="px-2.5 md:px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
      >
        {push.isPending ? '反映中...' : 'CBOへ反映'}
        {unsyncedCount > 0 && (
          <span className="bg-white text-blue-600 rounded-full px-1.5 py-0.5 text-xs font-bold leading-none">
            {unsyncedCount}
          </span>
        )}
      </button>

      {busy && (
        <span className="text-xs text-gray-500 animate-pulse">処理中...</span>
      )}
    </div>
  )
}
