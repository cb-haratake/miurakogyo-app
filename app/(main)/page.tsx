'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SiteCard } from '@/components/site-card'
import type { Site } from '@/types/db'

const FILTERS_STORAGE_KEY = 'site-list-filters'

function getStoredFilter(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return typeof parsed[key] === 'string' ? parsed[key] : fallback
  } catch {
    return fallback
  }
}

export default function SiteListPage() {
  const qc = useQueryClient()
  const [nameQuery, setNameQuery] = useState(() => getStoredFilter('nameQuery', ''))
  const [clientFilter, setClientFilter] = useState(() => getStoredFilter('clientFilter', ''))
  const [managerFilter, setManagerFilter] = useState(() => getStoredFilter('managerFilter', ''))
  const [asbestosFilter, setAsbestosFilter] = useState(() => getStoredFilter('asbestosFilter', ''))
  const [statusFilter, setStatusFilter] = useState(() => getStoredFilter('statusFilter', '工事中'))
  const [importResult, setImportResult] = useState<{ sites: { inserted: number; updated: number }; workers: number } | null>(null)

  useEffect(() => {
    sessionStorage.setItem(
      FILTERS_STORAGE_KEY,
      JSON.stringify({ nameQuery, clientFilter, managerFilter, asbestosFilter, statusFilter })
    )
  }, [nameQuery, clientFilter, managerFilter, asbestosFilter, statusFilter])

  const { data: sites = [], isLoading } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => fetch('/api/sites').then(r => r.json()),
  })

  const pullMasters = useMutation({
    mutationFn: () =>
      fetch('/api/sync/pull/masters', { method: 'POST' }).then(r => r.json()),
    onSuccess: (data) => {
      setImportResult(data)
      toast.success(
        `取込完了: 現場 新規${data.sites?.inserted ?? 0}件・更新${data.sites?.updated ?? 0}件 / 作業者${data.workers ?? 0}件`,
        { duration: 10000 }
      )
      qc.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: () => toast.error('マスタ取込に失敗しました', { duration: 8000 }),
  })

  // 選択肢（取込済みデータから動的生成）
  const clientOptions = useMemo(() => {
    return Array.from(new Set(sites.map(s => s.client_name).filter(Boolean) as string[])).sort()
  }, [sites])

  const managerOptions = useMemo(() => {
    return Array.from(new Set(sites.map(s => s.manager_name).filter(Boolean) as string[])).sort()
  }, [sites])

  // フィルタ適用
  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase()
    return sites.filter(site => {
      if (q && !site.name.toLowerCase().includes(q)) return false
      if (clientFilter && site.client_name !== clientFilter) return false
      if (managerFilter && site.manager_name !== managerFilter) return false
      if (asbestosFilter !== '' && String(site.is_asbestos) !== asbestosFilter) return false
      if (statusFilter && site.cbo_status !== statusFilter) return false
      return true
    })
  }, [sites, nameQuery, clientFilter, managerFilter, asbestosFilter, statusFilter])

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダ */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h1 className="text-xl font-bold">現場一覧</h1>
          <div className="flex flex-wrap items-center gap-2">
            {importResult && !pullMasters.isPending && (
              <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 whitespace-nowrap">
                完了: 現場 新規{importResult.sites.inserted}件・更新{importResult.sites.updated}件 / 作業者{importResult.workers}件
              </span>
            )}
            <button
              onClick={() => { setImportResult(null); pullMasters.mutate() }}
              disabled={pullMasters.isPending}
              className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
            >
              {pullMasters.isPending ? '取込中...' : 'CBOから取込（マスタ）'}
            </button>
          </div>
        </div>

        {/* 検索・フィルタ */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="現場名で検索..."
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 min-w-40"
          />
          <select
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white min-w-28"
          >
            <option value="">全管轄</option>
            {clientOptions.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={managerFilter}
            onChange={e => setManagerFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white min-w-28"
          >
            <option value="">全責任者</option>
            {managerOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={asbestosFilter}
            onChange={e => setAsbestosFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          >
            <option value="">石綿 全て</option>
            <option value="true">石綿あり</option>
            <option value="false">石綿なし</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white min-w-28"
          >
            <option value="">全ステータス</option>
            <option value="工事中">工事中</option>
            <option value="完工">完工</option>
          </select>
          {(nameQuery || clientFilter || managerFilter || asbestosFilter || statusFilter !== '工事中') && (
            <button
              onClick={() => { setNameQuery(''); setClientFilter(''); setManagerFilter(''); setAsbestosFilter(''); setStatusFilter('工事中') }}
              className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 rounded hover:bg-gray-100 whitespace-nowrap"
            >
              クリア
            </button>
          )}
          <span className="text-xs text-gray-400 whitespace-nowrap">{filtered.length}件</span>
        </div>
      </div>

      {/* 一覧 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && <p className="text-gray-400 text-sm">読み込み中...</p>}

        {!isLoading && sites.length === 0 && (
          <p className="text-gray-400 text-sm">
            現場データがありません。「CBOから取込（マスタ）」を実行してください。
          </p>
        )}

        {!isLoading && sites.length > 0 && filtered.length === 0 && (
          <p className="text-gray-400 text-sm">条件に一致する現場がありません。</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(site => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      </div>
    </div>
  )
}
