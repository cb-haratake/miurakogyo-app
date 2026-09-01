'use client'

import { useState } from 'react'
import type { ReportRow, WorkerSummary } from '@/types/frontend'
import { getDaysInMonth, getDayLabel, dayHeaderClass } from '@/lib/utils/date'
import { compareWorkers } from '@/lib/utils/sort'
import { CellEditor } from './cell-editor'

type Props = {
  siteId: string
  month: string
  reports: ReportRow[]
  workerOrder: Map<string, number>
  onRefresh: () => void
}

type EditTarget = { workerId: string; date: string; report: ReportRow | null }

const WORK_SHORT: Record<string, string> = {
  '106548': '①', '106549': '②', '106550': '③', '106551': '④',
  '106552': '⑤', '106553': '⑥', '106554': '⑦', '106555': '⑧',
}
const WORK_LABEL: Record<string, string> = {
  '106548': '① 準備工事', '106549': '② 石綿除去', '106550': '③ 環境測定', '106551': '④ 廃材処理',
  '106552': '⑤ 養生撤去', '106553': '⑥ 管理', '106554': '⑦ 抜き取り', '106555': '⑧ 分析',
}
const HEALTH_SHORT: Record<string, string> = {
  '106556': '〇', '106557': '△', '106558': '✖',
}
const HEALTH_COLOR: Record<string, string> = {
  '106556': 'text-green-600', '106557': 'text-yellow-600', '106558': 'text-red-600',
}

function buildWorkers(reports: ReportRow[], workerOrder: Map<string, number>): WorkerSummary[] {
  const map = new Map<string, WorkerSummary>()
  for (const r of reports) {
    if (!map.has(r.worker_id)) map.set(r.worker_id, r.worker)
  }
  return Array.from(map.values()).sort((a, b) => compareWorkers(a, b, workerOrder))
}

export function AsbestosGrid({ siteId, month, reports, workerOrder, onRefresh }: Props) {
  const days = getDaysInMonth(month)
  const workers = buildWorkers(reports, workerOrder)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const reportMap = new Map(reports.map(r => [`${r.worker_id}_${r.work_date}`, r]))

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Legend（携帯では非表示。セル編集時のプルダウンに全文表示されるため） */}
      <div className="max-md:hidden px-4 py-2 border-b border-gray-200 flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-xs text-gray-500 font-medium">作業内容:</span>
        {Object.entries(WORK_LABEL).map(([id, label]) => (
          <span key={id} className="text-xs text-gray-500">{label}</span>
        ))}
        <span className="text-xs text-gray-500 font-medium ml-2">健康:</span>
        <span className="text-xs text-green-600">〇良好</span>
        <span className="text-xs text-yellow-600">△やや不調</span>
        <span className="text-xs text-red-600">✖不調</span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto touch-manipulation">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 bg-gray-100 border border-gray-200 px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap"
                style={{ minWidth: 160 }}
              >
                所属 / 作業者
              </th>
              {days.map(day => {
                const { label } = getDayLabel(day)
                const dayNum = new Date(day + 'T00:00:00').getDate()
                return (
                  <th
                    key={day}
                    className={`sticky top-0 z-20 border border-gray-200 py-1 font-medium text-center ${dayHeaderClass(day)}`}
                    style={{ minWidth: 48 }}
                  >
                    <div>{dayNum}</div>
                    <div className="text-gray-400">{label}</div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {workers.map(worker => (
              <tr key={worker.id} className="hover:bg-gray-50/50">
                <td className="sticky left-0 z-10 bg-white border border-gray-200 px-2 py-1.5 whitespace-nowrap">
                  <div className="text-gray-400 text-xs leading-tight">{worker.company_name}</div>
                  <div className="font-medium text-gray-900">{worker.worker_name}</div>
                </td>
                {days.map(day => {
                  const report = reportMap.get(`${worker.id}_${day}`)
                  const wc = report?.work_content_id
                  const ht = report?.health_type_id

                  return (
                    <td
                      key={day}
                      onClick={() => setEditing({ workerId: worker.id, date: day, report: report ?? null })}
                      className={`border border-gray-200 cursor-pointer hover:bg-orange-50 text-center p-0.5 h-9 ${dayHeaderClass(day)}`}
                    >
                      {report && (
                        <div className="flex flex-col items-center justify-center h-full gap-0.5">
                          {wc && <span className="font-bold text-gray-700">{WORK_SHORT[wc] ?? '—'}</span>}
                          {ht && (
                            <span className={`leading-none ${HEALTH_COLOR[ht] ?? ''}`}>
                              {HEALTH_SHORT[ht] ?? '—'}
                            </span>
                          )}
                          {report.is_corrected && (
                            <span className="text-gray-400" title="修正済">修</span>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {workers.length === 0 && (
              <tr>
                <td colSpan={days.length + 1} className="text-center py-10 text-gray-400">
                  出面表からデータを取込むか、出面表で記録を作成してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <CellEditor
          siteId={siteId}
          workerId={editing.workerId}
          date={editing.date}
          report={editing.report}
          isAsbestos={true}
          onClose={() => setEditing(null)}
          onSuccess={() => { setEditing(null); onRefresh() }}
        />
      )}
    </div>
  )
}
