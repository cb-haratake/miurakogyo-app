'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { CellEditor } from '@/components/cell-editor'
import { formatMonth, addMonths, todayYearMonth } from '@/lib/utils/date'
import type { ReportRowWithSite } from '@/types/frontend'

type SortKey = 'work_date' | 'site' | 'worker'
type SortDir = 'asc' | 'desc'

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
  const [month, setMonth] = useState(todayYearMonth)
  const [siteFilter, setSiteFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [kubunFilter, setKubunFilter] = useState('')
  const [nameQuery, setNameQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('work_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [editing, setEditing] = useState<ReportRowWithSite | null>(null)

  const reportsKey = ['reports', month]
  const { data: reports = [], isLoading, isError } = useQuery<ReportRowWithSite[]>({
    queryKey: reportsKey,
    queryFn: async () => {
      const r = await fetch(`/api/reports?month=${month}`)
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

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const rows = useMemo(() => {
    const q = nameQuery.trim().toLowerCase()
    const filtered = reports.filter(r => {
      if (siteFilter && r.site.name !== siteFilter) return false
      if (companyFilter && r.worker.company_name !== companyFilter) return false
      if (kubunFilter && r.worker.source_kind !== kubunFilter) return false
      if (q && !r.worker.worker_name.toLowerCase().includes(q)) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'work_date') return a.work_date.localeCompare(b.work_date) * dir
      if (sortKey === 'site') return a.site.name.localeCompare(b.site.name, 'ja') * dir
      return a.worker.worker_name.localeCompare(b.worker.worker_name, 'ja') * dir
    })
  }, [reports, siteFilter, companyFilter, kubunFilter, nameQuery, sortKey, sortDir])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold mb-3">出面一覧</h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMonth(m => addMonths(m, -1))}
              className="text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100"
            >
              ◀
            </button>
            <span className="font-semibold text-gray-800 min-w-24 text-center">{formatMonth(month)}</span>
            <button
              onClick={() => setMonth(m => addMonths(m, 1))}
              className="text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100"
            >
              ▶
            </button>
          </div>
          <input
            type="text"
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="氏名で検索..."
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-40"
          />
          <select
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white min-w-28"
          >
            <option value="">全現場</option>
            {siteOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white min-w-28"
          >
            <option value="">全会社</option>
            {companyOptions.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={kubunFilter}
            onChange={e => setKubunFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          >
            <option value="">全区分</option>
            <option value="employee">自社員</option>
            <option value="partner">協力会社</option>
          </select>
          {(nameQuery || siteFilter || companyFilter || kubunFilter) && (
            <button
              onClick={() => { setNameQuery(''); setSiteFilter(''); setCompanyFilter(''); setKubunFilter('') }}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 rounded hover:bg-gray-100 whitespace-nowrap"
            >
              クリア
            </button>
          )}
          <span className="text-xs text-gray-400 whitespace-nowrap">{rows.length}件</span>
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
