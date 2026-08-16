'use client'

import { useMemo, useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DateRangeFilter } from '@/components/date-range-filter'
import { SyncLogDetailModal } from '@/components/sync-log-detail-modal'
import { resolveRelativeDateRange, type DateRange } from '@/lib/utils/date-range'
import { formatRelativeTime } from '@/lib/utils/date'
import type { SyncLog, DailyReport, Worker, Site } from '@/types/db'

// ===== 型 =====

type ConflictRow = DailyReport & {
  worker: Pick<Worker, 'id' | 'company_name' | 'worker_name'>
  site: Pick<Site, 'id' | 'name'>
  day_yakan: { id: string; label: string } | null
  work_content: { id: string; label: string } | null
  health_type: { id: string; label: string } | null
}

// ===== 競合解決パネル =====

function ConflictPanel() {
  const qc = useQueryClient()

  const { data: conflicts = [], isLoading } = useQuery<ConflictRow[]>({
    queryKey: ['conflicts'],
    queryFn: () => fetch('/api/conflicts').then(r => r.json()),
  })

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept_cbo' | 'mark_local' }) =>
      fetch(`/api/conflicts/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'エラー')
        return data
      }),
    onSuccess: (_, { action }) => {
      toast.success(
        action === 'accept_cbo'
          ? 'CBO版を採用しました'
          : '再push対象に設定しました。CBOへ反映ボタンで送信してください。'
      )
      qc.invalidateQueries({ queryKey: ['conflicts'] })
      qc.invalidateQueries({ queryKey: ['sync-logs'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <p className="text-gray-400 text-sm py-4">読み込み中...</p>
  if (!conflicts.length) {
    return (
      <p className="text-gray-400 text-sm py-4">
        競合はありません
      </p>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-red-50 border-b border-red-200">
          <tr>
            <th className="text-left px-4 py-2 text-xs font-medium text-red-700">現場</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-red-700">日付</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-red-700">作業者</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-red-700">昼/夜</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-red-700">作業内容</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-red-700">健康状態</th>
            <th className="px-4 py-2 text-xs font-medium text-red-700 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map(c => (
            <tr key={c.id} className="border-b border-gray-100 last:border-0 bg-red-50/30">
              <td className="px-4 py-2 text-xs text-gray-700">{c.site?.name ?? '—'}</td>
              <td className="px-4 py-2 text-xs whitespace-nowrap">
                {c.work_date}
              </td>
              <td className="px-4 py-2 text-xs">
                <div className="text-gray-400 text-xs">{c.worker?.company_name}</div>
                <div className="font-medium">{c.worker?.worker_name}</div>
              </td>
              <td className="px-4 py-2 text-xs">{c.day_yakan?.label ?? '—'}</td>
              <td className="px-4 py-2 text-xs text-gray-600">{c.work_content?.label ?? '—'}</td>
              <td className="px-4 py-2 text-xs">{c.health_type?.label ?? '—'}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap">
                <button
                  onClick={() => resolve.mutate({ id: c.id, action: 'accept_cbo' })}
                  disabled={resolve.isPending}
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 mr-1"
                  title="CBO版（上記の値）をそのまま使用する"
                >
                  CBO版を採用
                </button>
                <button
                  onClick={() => resolve.mutate({ id: c.id, action: 'mark_local' })}
                  disabled={resolve.isPending}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  title="この記録を再pushする（出面表で内容を確認後にCBOへ反映）"
                >
                  再push
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ===== 同期ログ =====

const TARGET_LABEL: Record<SyncLog['target'], string> = {
  site: '現場',
  worker: '作業者',
  report: '出面',
}

const PAGE_SIZE = 100

type SyncLogGroup = {
  key: string
  performed_at: string
  direction: SyncLog['direction']
  target: SyncLog['target']
  trigger_source: SyncLog['trigger_source']
  logs: SyncLog[]
}

function groupLogs(logs: SyncLog[]): SyncLogGroup[] {
  const groups: SyncLogGroup[] = []
  const indexByKey = new Map<string, number>()
  for (const log of logs) {
    const key = `${log.performed_at}|${log.direction}|${log.target}`
    const idx = indexByKey.get(key)
    if (idx !== undefined) {
      groups[idx].logs.push(log)
    } else {
      indexByKey.set(key, groups.length)
      groups.push({
        key, performed_at: log.performed_at, direction: log.direction,
        target: log.target, trigger_source: log.trigger_source, logs: [log],
      })
    }
  }
  return groups
}

function DirectionBadge({ direction }: { direction: SyncLog['direction'] }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
      direction === 'pull' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
    }`}>
      {direction === 'pull' ? '↓ 取込' : '↑ 反映'}
    </span>
  )
}

function TriggerBadge({ triggerSource }: { triggerSource: SyncLog['trigger_source'] }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
      triggerSource === 'cron' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
    }`}>
      {triggerSource === 'cron' ? '🤖 自動' : '👤 手動'}
    </span>
  )
}

function StatusBadge({ status }: { status: SyncLog['status'] }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
      status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {status === 'success' ? '成功' : 'エラー'}
    </span>
  )
}

function SyncLogRow({ log, indent, onDetail }: { log: SyncLog; indent?: boolean; onDetail: (log: SyncLog) => void }) {
  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
      <td className={`px-4 py-2 text-xs text-gray-500 whitespace-nowrap ${indent ? 'pl-8' : ''}`} title={new Date(log.performed_at).toLocaleString('ja-JP')}>
        {formatRelativeTime(log.performed_at)}
      </td>
      <td className="px-4 py-2"><TriggerBadge triggerSource={log.trigger_source} /></td>
      <td className="px-4 py-2"><DirectionBadge direction={log.direction} /></td>
      <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{TARGET_LABEL[log.target]}</td>
      <td className="px-4 py-2"><StatusBadge status={log.status} /></td>
      <td className="px-4 py-2 text-xs text-gray-600 max-w-xs truncate">{log.message}</td>
      <td className="px-4 py-2 text-right whitespace-nowrap">
        <button onClick={() => onDetail(log)} className="text-xs text-blue-600 hover:underline">詳細</button>
      </td>
    </tr>
  )
}

function SyncLogGroupRow({ group, onDetail }: { group: SyncLogGroup; onDetail: (log: SyncLog) => void }) {
  const [expanded, setExpanded] = useState(false)
  const successCount = group.logs.filter(l => l.status === 'success').length
  const errorCount = group.logs.length - successCount

  if (group.logs.length === 1) {
    return <SyncLogRow log={group.logs[0]} onDetail={onDetail} />
  }

  return (
    <>
      <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap" title={new Date(group.performed_at).toLocaleString('ja-JP')}>
          <span className="inline-block w-3">{expanded ? '▼' : '▶'}</span>
          {formatRelativeTime(group.performed_at)}
        </td>
        <td className="px-4 py-2"><TriggerBadge triggerSource={group.trigger_source} /></td>
        <td className="px-4 py-2"><DirectionBadge direction={group.direction} /></td>
        <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{TARGET_LABEL[group.target]}</td>
        <td className="px-4 py-2">
          {errorCount > 0 ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap">
              {successCount}件成功・{errorCount}件エラー
            </span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 whitespace-nowrap">
              {successCount}件成功
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-xs text-gray-400" colSpan={2}>{group.logs.length}件（クリックで展開）</td>
      </tr>
      {expanded && group.logs.map(log => (
        <SyncLogRow key={log.id} log={log} indent onDetail={onDetail} />
      ))}
    </>
  )
}

function SyncLogTable() {
  const [dateRange, setDateRange] = useState<DateRange>(() => resolveRelativeDateRange('this_month'))
  const [direction, setDirection] = useState<'' | SyncLog['direction']>('')
  const [target, setTarget] = useState<'' | SyncLog['target']>('')
  const [status, setStatus] = useState<'' | SyncLog['status']>('')
  const [triggerSource, setTriggerSource] = useState<'' | SyncLog['trigger_source']>('')
  const [q, setQ] = useState('')
  const [detailLog, setDetailLog] = useState<SyncLog | null>(null)

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['sync-logs', dateRange.from, dateRange.to, direction, target, status, triggerSource, q],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        from: dateRange.from, to: dateRange.to,
        limit: String(PAGE_SIZE), offset: String(pageParam),
      })
      if (direction) params.set('direction', direction)
      if (target) params.set('target', target)
      if (status) params.set('status', status)
      if (triggerSource) params.set('triggerSource', triggerSource)
      if (q.trim()) params.set('q', q.trim())
      const r = await fetch(`/api/sync/logs?${params}`)
      if (!r.ok) throw new Error(await r.text())
      return r.json() as Promise<{ logs: SyncLog[]; total: number }>
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.logs.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    refetchInterval: 30_000,
  })

  const logs = useMemo(() => data?.pages.flatMap(p => p.logs) ?? [], [data])
  const total = data?.pages[0]?.total ?? 0
  const groups = useMemo(() => groupLogs(logs), [logs])

  const hasFilters = direction || target || status || triggerSource || q

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="メッセージで検索..."
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-40"
        />
        <select
          value={triggerSource}
          onChange={e => setTriggerSource(e.target.value as typeof triggerSource)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
        >
          <option value="">全トリガー元</option>
          <option value="cron">自動（CRON）</option>
          <option value="user">手動</option>
        </select>
        <select
          value={direction}
          onChange={e => setDirection(e.target.value as typeof direction)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
        >
          <option value="">全方向</option>
          <option value="pull">取込</option>
          <option value="push">反映</option>
        </select>
        <select
          value={target}
          onChange={e => setTarget(e.target.value as typeof target)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
        >
          <option value="">全対象</option>
          <option value="site">現場</option>
          <option value="worker">作業者</option>
          <option value="report">出面</option>
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value as typeof status)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
        >
          <option value="">全状態</option>
          <option value="success">成功</option>
          <option value="error">エラー</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => { setDirection(''); setTarget(''); setStatus(''); setTriggerSource(''); setQ('') }}
            className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 rounded hover:bg-gray-100 whitespace-nowrap"
          >
            クリア
          </button>
        )}
        <span className="text-xs text-gray-400 whitespace-nowrap">{total}件</span>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">日時</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">トリガー元</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">方向</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">対象</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">状態</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500" colSpan={2}>メッセージ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-gray-400 text-sm">読み込み中...</td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-red-400 text-sm">ログの取得に失敗しました</td>
              </tr>
            )}
            {groups.map(group => (
              <SyncLogGroupRow key={group.key} group={group} onDetail={setDetailLog} />
            ))}
            {!isLoading && !isError && !groups.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">条件に一致するログがありません</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasNextPage && (
        <div className="text-center mt-3">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="text-sm px-4 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetchingNextPage ? '読み込み中...' : 'もっと見る'}
          </button>
        </div>
      )}

      {detailLog && <SyncLogDetailModal log={detailLog} onClose={() => setDetailLog(null)} />}
    </div>
  )
}

// ===== ページ =====

export default function SyncPage() {
  const [tab, setTab] = useState<'conflicts' | 'logs'>('conflicts')

  const { data: conflicts = [] } = useQuery<ConflictRow[]>({
    queryKey: ['conflicts'],
    queryFn: () => fetch('/api/conflicts').then(r => r.json()),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 pt-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex gap-4">
          <button
            onClick={() => setTab('conflicts')}
            className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 ${
              tab === 'conflicts' ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            競合レコード
            {conflicts.length > 0 && (
              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">
                {conflicts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('logs')}
            className={`pb-3 text-sm font-medium border-b-2 ${
              tab === 'logs' ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            同期ログ
          </button>
        </div>
      </div>

      <div className="p-6 overflow-y-auto flex-1">
        {tab === 'conflicts' && (
          <section>
            <p className="text-xs text-gray-400 mb-3">
              取込時に CBO 側とアプリ側の両方で変更があったレコードです。
              「CBO版を採用」で取込済みの値を確定、「再push」でアプリ版として CBOへ反映します。
            </p>
            <ConflictPanel />
          </section>
        )}

        {tab === 'logs' && (
          <section>
            <SyncLogTable />
          </section>
        )}
      </div>
    </div>
  )
}
