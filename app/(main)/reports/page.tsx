'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { toast } from 'sonner'
import { CellEditor } from '@/components/cell-editor'
import { DateRangeFilter } from '@/components/date-range-filter'
import { ComboFilter } from '@/components/combo-filter'
import { resolveRelativeDateRange, type DateRange } from '@/lib/utils/date-range'
import type { ReportRowWithSite } from '@/types/frontend'
import type { SyncStatus } from '@/types/db'

type SortKey = 'work_date' | 'site' | 'worker'
type SortDir = 'asc' | 'desc'

const SYNC_STATUS_DISPLAY: Record<SyncStatus, { label: string; className: string }> = {
  local_new: { label: '取込未済', className: 'bg-blue-100 text-blue-700' },
  synced: { label: '取込済み', className: 'bg-gray-100 text-gray-600' },
  local_edited: { label: '取込後変更あり', className: 'bg-orange-100 text-orange-700' },
  // 競合はCBO側の変更を前提にしないため、取込後変更ありと同一表示にまとめる（解決は/syncページで行う）
  conflict: { label: '取込後変更あり', className: 'bg-orange-100 text-orange-700' },
}

function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const { label, className } = SYNC_STATUS_DISPLAY[status]
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${className}`}>{label}</span>
  )
}

function SortHeader({
  label, sortKey, currentKey, currentDir, onSort,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === currentKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="text-left px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap"
    >
      {label} {active && (currentDir === 'asc' ? '▲' : '▼')}
    </th>
  )
}

export default function ReportListPage() {
  const qc = useQueryClient()
  const [dateRange, setDateRange] = useState<DateRange>(() => resolveRelativeDateRange('this_month'))
  const [siteFilter, setSiteFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [kubunFilter, setKubunFilter] = useState('')
  const [syncStatusFilter, setSyncStatusFilter] = useState<'' | 'local_new' | 'synced' | 'local_edited'>('')
  const [nameQuery, setNameQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('work_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [editing, setEditing] = useState<ReportRowWithSite | null>(null)

  const reportsKey = ['reports', dateRange.from, dateRange.to]
  const { data: reports = [], isLoading, isError } = useQuery<ReportRowWithSite[]>({
    queryKey: reportsKey,
    queryFn: async () => {
      const r = await fetch(`/api/reports?from=${dateRange.from}&to=${dateRange.to}`)
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
  })

  const siteOptions = useMemo(() => {
    return Array.from(new Set(reports.map(r => r.site.name))).sort()
  }, [reports])

  const companyOptions = useMemo(() => {
    return Array.from(new Set(reports.map(r => r.worker.company_name))).sort()
  }, [reports])

  const nameOptions = useMemo(() => {
    return Array.from(new Set(reports.map(r => r.worker.worker_name))).sort()
  }, [reports])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const rows = useMemo(() => {
    const site = siteFilter.trim().toLowerCase()
    const company = companyFilter.trim().toLowerCase()
    const name = nameQuery.trim().toLowerCase()
    const filtered = reports.filter(r => {
      if (site && !r.site.name.toLowerCase().includes(site)) return false
      if (company && !r.worker.company_name.toLowerCase().includes(company)) return false
      if (kubunFilter && r.worker.source_kind !== kubunFilter) return false
      if (syncStatusFilter === 'local_edited' && r.sync_status !== 'local_edited' && r.sync_status !== 'conflict') return false
      if (syncStatusFilter && syncStatusFilter !== 'local_edited' && r.sync_status !== syncStatusFilter) return false
      if (name && !r.worker.worker_name.toLowerCase().includes(name)) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'work_date') return a.work_date.localeCompare(b.work_date) * dir
      if (sortKey === 'site') return a.site.name.localeCompare(b.site.name, 'ja') * dir
      return a.worker.worker_name.localeCompare(b.worker.worker_name, 'ja') * dir
    })
  }, [reports, siteFilter, companyFilter, kubunFilter, syncStatusFilter, nameQuery, sortKey, sortDir])

  const unsyncedRows = useMemo(
    () => rows.filter(r => r.sync_status === 'local_new' || r.sync_status === 'local_edited'),
    [rows]
  )

  const push = useMutation({
    mutationFn: () =>
      fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unsyncedRows.map(r => r.id) }),
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

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold mb-3">出面一覧</h1>

        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <ComboFilter
            value={nameQuery}
            onChange={setNameQuery}
            options={nameOptions}
            placeholder="氏名で検索..."
            allLabel="全員"
            className="min-w-40"
          />
          <ComboFilter
            value={siteFilter}
            onChange={setSiteFilter}
            options={siteOptions}
            placeholder="現場名で検索..."
            allLabel="全現場"
            className="min-w-40"
          />
          <ComboFilter
            value={companyFilter}
            onChange={setCompanyFilter}
            options={companyOptions}
            placeholder="会社名で検索..."
            allLabel="全会社"
            className="min-w-40"
          />
          <select
            value={kubunFilter}
            onChange={e => setKubunFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          >
            <option value="">全区分</option>
            <option value="employee">自社員</option>
            <option value="partner">協力会社</option>
          </select>
          <select
            value={syncStatusFilter}
            onChange={e => setSyncStatusFilter(e.target.value as typeof syncStatusFilter)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          >
            <option value="">全同期状態</option>
            <option value="local_new">取込未済</option>
            <option value="synced">取込済み</option>
            <option value="local_edited">取込後変更あり</option>
          </select>
          {(nameQuery || siteFilter || companyFilter || kubunFilter || syncStatusFilter) && (
            <button
              onClick={() => { setNameQuery(''); setSiteFilter(''); setCompanyFilter(''); setKubunFilter(''); setSyncStatusFilter('') }}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 rounded hover:bg-gray-100 whitespace-nowrap"
            >
              クリア
            </button>
          )}
          <span className="text-xs text-gray-400 whitespace-nowrap">{rows.length}件</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => push.mutate()}
              disabled={push.isPending || unsyncedRows.length === 0}
              className="px-2.5 md:px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              {push.isPending ? '反映中...' : 'CBOへ反映'}
              {unsyncedRows.length > 0 && (
                <span className="bg-white text-blue-600 rounded-full px-1.5 py-0.5 text-xs font-bold leading-none">
                  {unsyncedRows.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && <p className="text-gray-400 text-sm">読み込み中...</p>}
        {isError && <p className="text-red-400 text-sm">データの取得に失敗しました</p>}

        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-gray-400 text-sm">条件に一致する出面記録がありません。</p>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">同期</th>
                  <SortHeader label="日付" sortKey="work_date" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortHeader label="現場名" sortKey="site" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">区分</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">会社名</th>
                  <SortHeader label="氏名" sortKey="worker" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">勤務区分</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">残業</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">石綿従事者作業記録</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">健康状態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setEditing(r)}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 whitespace-nowrap"><SyncStatusBadge status={r.sync_status} /></td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.work_date}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      <Link href={`/sites/${r.site.id}/attendance`} onClick={e => e.stopPropagation()} className="hover:text-blue-600">
                        {r.site.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {r.worker.source_kind === 'employee' ? '自社員' : '協力会社'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.worker.company_name}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.worker.worker_name}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.day_yakan?.label ?? '—'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.over_hour ? `${r.over_hour}時間` : '—'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.site.is_asbestos ? (r.work_content?.label ?? '—') : '—'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.site.is_asbestos ? (r.health_type?.label ?? '—') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CellEditor
          siteId={editing.site.id}
          workerId={editing.worker.id}
          date={editing.work_date}
          report={editing}
          isAsbestos={editing.site.is_asbestos}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: reportsKey })
          }}
        />
      )}
    </div>
  )
}
