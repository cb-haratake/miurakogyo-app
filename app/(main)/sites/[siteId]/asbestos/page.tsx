'use client'

import { useState, use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { AsbestosGrid } from '@/components/asbestos-grid'
import { SyncBar } from '@/components/sync-bar'
import { formatMonth, addMonths, todayYearMonth } from '@/lib/utils/date'
import type { Site } from '@/types/db'
import type { ReportRow } from '@/types/frontend'


export default function AsbestosPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = use(params)
  const [month, setMonth] = useState(todayYearMonth)
  const qc = useQueryClient()

  const { data: site } = useQuery<Site>({
    queryKey: ['site', siteId],
    queryFn: () => fetch(`/api/sites/${siteId}`).then(r => r.json()),
  })

  const reportsKey = ['site', siteId, 'reports', month]
  const { data: reports = [], isLoading } = useQuery<ReportRow[]>({
    queryKey: reportsKey,
    queryFn: () =>
      fetch(`/api/sites/${siteId}/reports?month=${month}`).then(r => r.json()),
  })

  const unsyncedCount = reports.filter(
    r => r.sync_status === 'local_new' || r.sync_status === 'local_edited'
  ).length

  const { data: workerOrderRows = [] } = useQuery<{ worker_id: string; sort_order: number }[]>({
    queryKey: ['site', siteId, 'worker-order'],
    queryFn: () => fetch(`/api/sites/${siteId}/worker-order`).then(r => r.json()),
  })
  const workerOrder = new Map(workerOrderRows.map(r => [r.worker_id, r.sort_order]))

  return (
    <div className="flex flex-col h-full">
      {/* 通常ヘッダ（印刷時は非表示） */}
      <div className="px-3 py-2 md:px-5 md:py-3 bg-white border-b border-gray-200 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Link href="/" className="hover:text-blue-600">現場一覧</Link>
              <span>/</span>
              <span>{site?.name ?? '...'}</span>
            </div>
            <h1 className="text-lg font-bold text-gray-900 mt-0.5 max-md:hidden">石綿作業従事者作業記録</h1>
            <div className="text-xs text-gray-500 mt-0.5 space-x-3 max-md:hidden">
              {site?.client_name && <span>管轄: {site.client_name}</span>}
              {site?.manager_name && <span>責任者: {site.manager_name}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/sites/${siteId}/asbestos-export?month=${month}`}
              download
              className="max-md:hidden text-xs px-3 py-1.5 border border-green-300 text-green-700 rounded hover:bg-green-50"
            >
              Excel出力
            </a>
            <Link
              href={`/sites/${siteId}/attendance`}
              className="text-xs px-3 py-1.5 border border-blue-300 text-blue-600 rounded hover:bg-blue-50"
            >
              ← 出面表
            </Link>
          </div>
        </div>

        {/* Month switcher */}
        <div className="flex flex-wrap items-center gap-2 md:gap-4 gap-y-2 mt-2 md:mt-3">
          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={() => setMonth(m => addMonths(m, -1))}
              className="text-gray-500 hover:text-gray-800 px-2 py-0.5 max-md:px-2.5 max-md:py-1 rounded hover:bg-gray-100"
            >
              ◀
            </button>
            <span className="font-semibold text-gray-800 min-w-24 max-md:min-w-20 max-md:text-sm text-center">
              {formatMonth(month)}
            </span>
            <button
              onClick={() => setMonth(m => addMonths(m, 1))}
              className="text-gray-500 hover:text-gray-800 px-2 py-0.5 max-md:px-2.5 max-md:py-1 rounded hover:bg-gray-100"
            >
              ▶
            </button>
          </div>

          <div className="flex-1 max-md:hidden" />

          <div className="max-md:hidden">
            <SyncBar
              siteId={siteId}
              month={month}
              unsyncedCount={unsyncedCount}
              reportsQueryKey={reportsKey}
              inline
            />
          </div>
        </div>
      </div>

      {/* Grid（印刷時は非表示） */}
      <div className="flex flex-col flex-1 overflow-hidden print:hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-gray-400 text-sm">
            読み込み中...
          </div>
        ) : (
          <AsbestosGrid
            siteId={siteId}
            month={month}
            reports={reports}
            workerOrder={workerOrder}
            onRefresh={() => qc.invalidateQueries({ queryKey: reportsKey })}
          />
        )}
      </div>
    </div>
  )
}
