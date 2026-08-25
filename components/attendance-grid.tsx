'use client'

import { useState, useEffect, useRef, useMemo, useSyncExternalStore, Fragment } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ReportRow, WorkerSummary } from '@/types/frontend'
import type { Worker } from '@/types/db'
import { getDaysInMonth, getDayLabel, dayHeaderClass } from '@/lib/utils/date'
import { compareWorkers } from '@/lib/utils/sort'
import { CellEditor } from './cell-editor'
import { AddWorkerModal } from './add-worker-modal'
import { BulkEditModal, type BulkCell } from './bulk-edit-modal'

type Props = {
  siteId: string
  month: string
  reports: ReportRow[]
  isAsbestos: boolean
  onRefresh: () => void
}

// タッチ主体の端末（スマホ・タブレット）かどうか。SSR時は false
function subscribeCoarsePointer(callback: () => void) {
  const mq = window.matchMedia('(pointer: coarse)')
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false
  )
}

type EditTarget = { workerId: string; date: string; report: ReportRow | null }

type Selection = {
  anchor: { wIdx: number; dIdx: number }
  active: { wIdx: number; dIdx: number }
}

type ClipboardData = {
  rows: number
  cols: number
  grid: (ReportRow | null)[][]
}

type BulkCellPayload = {
  worker_id: string
  work_date: string
  day_yakan_id: string | null
  over_hour: number
  work_content_id: string | null
  health_type_id: string | null
  existing_id?: string
}

function selectionRange(sel: Selection) {
  return {
    minW: Math.min(sel.anchor.wIdx, sel.active.wIdx),
    maxW: Math.max(sel.anchor.wIdx, sel.active.wIdx),
    minD: Math.min(sel.anchor.dIdx, sel.active.dIdx),
    maxD: Math.max(sel.anchor.dIdx, sel.active.dIdx),
  }
}

function isCellSelected(wIdx: number, dIdx: number, sel: Selection | null): boolean {
  if (!sel) return false
  const { minW, maxW, minD, maxD } = selectionRange(sel)
  return wIdx >= minW && wIdx <= maxW && dIdx >= minD && dIdx <= maxD
}

const STATUS_BORDER: Record<string, string> = {
  local_new: 'border-dashed border-blue-400 bg-blue-50',
  local_edited: 'border-orange-400 bg-orange-50',
  conflict: 'border-red-500 bg-red-50',
  synced: 'border-gray-200',
}

const STATUS_BADGE: Record<string, string> = {
  local_new: '!',
  local_edited: '▲',
  conflict: '✕',
  synced: '',
}

const STATUS_BADGE_COLOR: Record<string, string> = {
  local_new: 'text-blue-500',
  local_edited: 'text-orange-500',
  conflict: 'text-red-500',
  synced: '',
}

export function AttendanceGrid({ siteId, month, reports, isAsbestos, onRefresh }: Props) {
  const days = getDaysInMonth(month)

  const [extraWorkers, setExtraWorkers] = useState<Worker[]>([])
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [showTotals, setShowTotals] = useState(false)
  const isCoarse = useCoarsePointer()
  const [selectMode, setSelectMode] = useState(false)

  // Map of all available workers (reports + manually added)
  const allWorkerMap = useMemo(() => {
    const map = new Map<string, WorkerSummary>()
    for (const r of reports) {
      if (!map.has(r.worker_id)) map.set(r.worker_id, r.worker)
    }
    for (const w of extraWorkers) {
      if (!map.has(w.id)) map.set(w.id, w as unknown as WorkerSummary)
    }
    return map
  }, [reports, extraWorkers])

  const allWorkers = useMemo(() =>
    [...allWorkerMap.values()].sort(compareWorkers),
    [allWorkerMap]
  )

  const reportMap = new Map(reports.map(r => [`${r.worker_id}_${r.work_date}`, r]))
  const excludeIds = allWorkers.map(w => w.id)

  // 人工合計（showTotals=true のときのみ算出）
  const workerDayCounts = useMemo(() => {
    if (!showTotals) return new Map<string, number>()
    return new Map(allWorkers.map(w => [
      w.id,
      days.filter(day => reportMap.has(`${w.id}_${day}`)).length,
    ]))
  // reportMap は reports から再生成されるため reports を依存に含める
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTotals, allWorkers, days, reports])

  // --- Cell selection helpers ---
  const hasDraggedRef = useRef(false)
  const lastClickedRef = useRef<{ wIdx: number; dIdx: number } | null>(null)

  // Always-current snapshot for the stable keydown handler
  const stateRef = useRef({
    selection: null as Selection | null,
    clipboard: null as ClipboardData | null,
    allWorkers: [] as WorkerSummary[],
    days: [] as string[],
    reportMap: new Map<string, ReportRow>(),
    editing: null as EditTarget | null,
    showBulkEdit: false,
  })
  stateRef.current = { selection, clipboard, allWorkers, days, reportMap, editing, showBulkEdit }

  const pasteMutateRef = useRef<((cells: BulkCellPayload[]) => void) | null>(null)
  const deleteMutateRef = useRef<((ids: string[]) => void) | null>(null)

  const pasteMutation = useMutation({
    mutationFn: async (cells: BulkCellPayload[]) => {
      const res = await fetch('/api/reports/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, cells }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'エラー')
      return data as { created: number; updated: number; errors: unknown[] }
    },
    onSuccess: (data) => {
      const parts = [
        data.created > 0 && `${data.created}件作成`,
        data.updated > 0 && `${data.updated}件更新`,
      ].filter(Boolean).join('・')
      toast.success(`貼り付け完了：${parts || '0件'}`)
      onRefresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  pasteMutateRef.current = pasteMutation.mutate

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/reports/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'エラー')
      return data as { deleted: number }
    },
    onSuccess: (data) => {
      toast.success(`${data.deleted}件削除しました`)
      setSelection(null)
      onRefresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  deleteMutateRef.current = deleteMutation.mutate

  // End cell-selection drag on global mouseup
  useEffect(() => {
    const up = () => setIsDragging(false)
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [])

  // Keyboard shortcuts — registered once, reads state from stateRef
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { selection, clipboard, allWorkers, days, reportMap, editing, showBulkEdit } =
        stateRef.current
      if (editing || showBulkEdit) return
      if (!selection) return

      if (e.key === 'Escape') {
        setSelection(null)
        e.preventDefault()
        return
      }

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        const { minW, maxW, minD, maxD } = selectionRange(selection)
        if (minW === maxW && minD === maxD) {
          const worker = allWorkers[minW]
          const day = days[minD]
          setEditing({ workerId: worker.id, date: day, report: reportMap.get(`${worker.id}_${day}`) ?? null })
          setSelection(null)
        } else {
          setShowBulkEdit(true)
        }
        e.preventDefault()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const { minW, maxW, minD, maxD } = selectionRange(selection)
        const grid: (ReportRow | null)[][] = []
        for (let wi = minW; wi <= maxW; wi++) {
          const row: (ReportRow | null)[] = []
          for (let di = minD; di <= maxD; di++) {
            row.push(reportMap.get(`${allWorkers[wi]?.id}_${days[di]}`) ?? null)
          }
          grid.push(row)
        }
        setClipboard({ rows: maxW - minW + 1, cols: maxD - minD + 1, grid })
        toast.success(`${(maxW - minW + 1) * (maxD - minD + 1)}件をコピーしました`)
        e.preventDefault()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { minW, maxW, minD, maxD } = selectionRange(selection)
        const ids: string[] = []
        for (let wi = minW; wi <= maxW; wi++) {
          for (let di = minD; di <= maxD; di++) {
            const r = reportMap.get(`${allWorkers[wi]?.id}_${days[di]}`)
            if (r) ids.push(r.id)
          }
        }
        if (ids.length === 0) return
        if (!window.confirm(`${ids.length}件の出面記録を削除しますか？`)) return
        deleteMutateRef.current?.(ids)
        e.preventDefault()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard) {
        const { minW: startW, minD: startD, maxW: endW, maxD: endD } = selectionRange(selection)
        const isSingleCell = clipboard.rows === 1 && clipboard.cols === 1
        const singleSrc = isSingleCell ? clipboard.grid[0]?.[0] : null
        const cells: BulkCellPayload[] = []
        if (isSingleCell && singleSrc) {
          for (let wIdx = startW; wIdx <= endW; wIdx++) {
            for (let dIdx = startD; dIdx <= endD; dIdx++) {
              const worker = allWorkers[wIdx]
              const day = days[dIdx]
              cells.push({
                worker_id: worker.id, work_date: day,
                day_yakan_id: singleSrc.day_yakan_id, over_hour: singleSrc.over_hour,
                work_content_id: singleSrc.work_content_id, health_type_id: singleSrc.health_type_id,
                existing_id: reportMap.get(`${worker.id}_${day}`)?.id,
              })
            }
          }
        } else {
          for (let ri = 0; ri < clipboard.rows; ri++) {
            for (let ci = 0; ci < clipboard.cols; ci++) {
              const wIdx = startW + ri
              const dIdx = startD + ci
              if (wIdx >= allWorkers.length || dIdx >= days.length) continue
              const src = clipboard.grid[ri]?.[ci]
              if (!src) continue
              const worker = allWorkers[wIdx]
              const day = days[dIdx]
              cells.push({
                worker_id: worker.id, work_date: day,
                day_yakan_id: src.day_yakan_id, over_hour: src.over_hour,
                work_content_id: src.work_content_id, health_type_id: src.health_type_id,
                existing_id: reportMap.get(`${worker.id}_${day}`)?.id,
              })
            }
          }
        }
        if (cells.length > 0) pasteMutateRef.current?.(cells)
        e.preventDefault()
        return
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function handleCellMouseDown(wIdx: number, dIdx: number, e: React.MouseEvent) {
    e.preventDefault()
    hasDraggedRef.current = false

    // タッチ端末: ドラッグ選択は使わず、選択モード中のタップで矩形を拡張する
    if (isCoarse) {
      hasDraggedRef.current = true
      if (selectMode) {
        setSelection(prev =>
          prev
            ? { anchor: prev.anchor, active: { wIdx, dIdx } }
            : { anchor: { wIdx, dIdx }, active: { wIdx, dIdx } }
        )
      }
      return
    }

    if (e.shiftKey && selection) {
      setSelection({ anchor: selection.anchor, active: { wIdx, dIdx } })
      hasDraggedRef.current = true
      lastClickedRef.current = null
      return
    }

    setSelection({ anchor: { wIdx, dIdx }, active: { wIdx, dIdx } })
    setIsDragging(true)
  }

  function handleCellMouseEnter(wIdx: number, dIdx: number) {
    if (!isDragging || !selection) return
    if (wIdx !== selection.anchor.wIdx || dIdx !== selection.anchor.dIdx) {
      hasDraggedRef.current = true
    }
    setSelection(prev => (prev ? { anchor: prev.anchor, active: { wIdx, dIdx } } : null))
  }

  function handleCellMouseUp(wIdx: number, dIdx: number, worker: WorkerSummary, day: string) {
    // タッチ端末: 通常モードはシングルタップで即エディタを開く
    if (isCoarse) {
      if (!selectMode) {
        const report = reportMap.get(`${worker.id}_${day}`) ?? null
        setEditing({ workerId: worker.id, date: day, report })
        setSelection(null)
      }
      return
    }

    if (!hasDraggedRef.current) {
      const last = lastClickedRef.current
      if (last && last.wIdx === wIdx && last.dIdx === dIdx) {
        const report = reportMap.get(`${worker.id}_${day}`) ?? null
        setEditing({ workerId: worker.id, date: day, report })
        setSelection(null)
        lastClickedRef.current = null
      } else {
        lastClickedRef.current = { wIdx, dIdx }
      }
    }
    setIsDragging(false)
  }

  function handleCopyToolbar() {
    if (!selection) return
    const { minW, maxW, minD, maxD } = selectionRange(selection)
    const grid: (ReportRow | null)[][] = []
    for (let wi = minW; wi <= maxW; wi++) {
      const row: (ReportRow | null)[] = []
      for (let di = minD; di <= maxD; di++) {
        row.push(reportMap.get(`${allWorkers[wi].id}_${days[di]}`) ?? null)
      }
      grid.push(row)
    }
    setClipboard({ rows: maxW - minW + 1, cols: maxD - minD + 1, grid })
    toast.success(`${(maxW - minW + 1) * (maxD - minD + 1)}件をコピーしました`)
  }

  function handlePasteToolbar() {
    if (!selection || !clipboard) return
    const { minW: startW, minD: startD, maxW: endW, maxD: endD } = selectionRange(selection)
    const isSingleCell = clipboard.rows === 1 && clipboard.cols === 1
    const singleSrc = isSingleCell ? clipboard.grid[0]?.[0] : null
    const cells: BulkCellPayload[] = []
    if (isSingleCell && singleSrc) {
      for (let wIdx = startW; wIdx <= endW; wIdx++) {
        for (let dIdx = startD; dIdx <= endD; dIdx++) {
          const worker = allWorkers[wIdx]
          const day = days[dIdx]
          cells.push({
            worker_id: worker.id, work_date: day,
            day_yakan_id: singleSrc.day_yakan_id, over_hour: singleSrc.over_hour,
            work_content_id: singleSrc.work_content_id, health_type_id: singleSrc.health_type_id,
            existing_id: reportMap.get(`${worker.id}_${day}`)?.id,
          })
        }
      }
    } else {
      for (let ri = 0; ri < clipboard.rows; ri++) {
        for (let ci = 0; ci < clipboard.cols; ci++) {
          const wIdx = startW + ri
          const dIdx = startD + ci
          if (wIdx >= allWorkers.length || dIdx >= days.length) continue
          const src = clipboard.grid[ri]?.[ci]
          if (!src) continue
          const worker = allWorkers[wIdx]
          const day = days[dIdx]
          cells.push({
            worker_id: worker.id, work_date: day,
            day_yakan_id: src.day_yakan_id, over_hour: src.over_hour,
            work_content_id: src.work_content_id, health_type_id: src.health_type_id,
            existing_id: reportMap.get(`${worker.id}_${day}`)?.id,
          })
        }
      }
    }
    if (cells.length > 0) pasteMutation.mutate(cells)
  }

  const selCount = selection
    ? (() => {
        const { minW, maxW, minD, maxD } = selectionRange(selection)
        return (maxW - minW + 1) * (maxD - minD + 1)
      })()
    : 0

  const selectedReportIds = selection
    ? (() => {
        const { minW, maxW, minD, maxD } = selectionRange(selection)
        const ids: string[] = []
        for (let wi = minW; wi <= maxW; wi++) {
          for (let di = minD; di <= maxD; di++) {
            const r = reportMap.get(`${allWorkers[wi]?.id}_${days[di]}`)
            if (r) ids.push(r.id)
          }
        }
        return ids
      })()
    : []

  function handleDeleteToolbar() {
    if (selectedReportIds.length === 0) return
    if (!window.confirm(`${selectedReportIds.length}件の出面記録を削除しますか？`)) return
    deleteMutation.mutate(selectedReportIds)
  }

  const bulkCells: BulkCell[] = selection
    ? (() => {
        const { minW, maxW, minD, maxD } = selectionRange(selection)
        const out: BulkCell[] = []
        for (let wi = minW; wi <= maxW; wi++) {
          for (let di = minD; di <= maxD; di++) {
            const worker = allWorkers[wi]
            const day = days[di]
            out.push({ workerId: worker.id, workerName: worker.worker_name, date: day, report: reportMap.get(`${worker.id}_${day}`) ?? null })
          }
        }
        return out
      })()
    : []

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 gap-y-1 px-3 py-1.5 md:px-4 md:py-2 border-b border-gray-200 min-h-[38px] md:min-h-[44px]">
        {isCoarse && (
          <button
            onClick={() => {
              setSelectMode(v => {
                if (v) setSelection(null)
                return !v
              })
            }}
            className={`text-sm px-3 py-1.5 border rounded ${selectMode ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            選択モード
          </button>
        )}
        {selection ? (
          <>
            <span className="text-sm font-medium text-blue-700">{selCount}件選択中</span>
            <button
              onClick={() => setShowBulkEdit(true)}
              className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              一括入力
            </button>
            <button
              onClick={handleCopyToolbar}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
            >
              コピー
            </button>
            {clipboard && (
              <button
                onClick={handlePasteToolbar}
                disabled={pasteMutation.isPending}
                className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                貼り付け
              </button>
            )}
            {selectedReportIds.length > 0 && (
              <button
                onClick={handleDeleteToolbar}
                disabled={deleteMutation.isPending}
                className="text-sm px-3 py-1.5 border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
              >
                削除（{selectedReportIds.length}件）
              </button>
            )}
            <button
              onClick={() => setSelection(null)}
              className="text-sm px-2 py-1.5 text-gray-500 hover:text-gray-700"
            >
              解除
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
            >
              ＋ 作業者を追加
            </button>
            <button
              onClick={() => setShowTotals(v => !v)}
              className={`text-sm px-3 py-1.5 border rounded ${showTotals ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              人工合計
            </button>
            {clipboard && (
              <span className="text-xs text-gray-400 ml-2 italic">
                {isCoarse ? 'コピー済（セル選択後に貼り付け）' : 'コピー済（セル選択後に Ctrl+V）'}
              </span>
            )}
            <span className="ml-auto text-xs text-gray-600 max-md:hidden">
              延べ人数: <span className="font-semibold">{reports.length}人日</span>
            </span>
          </>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto touch-manipulation" style={{ userSelect: 'none' }}>
        {/* border-collapse は sticky セルと組み合わせるとスクロール中に罫線がずれる
            既知の不具合があるため border-separate に変更する */}
        <table className="border-separate border-spacing-0 text-xs">
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
                const count = allWorkers.filter(w => reportMap.has(`${w.id}_${day}`)).length
                return (
                  <th
                    key={day}
                    className={`sticky top-0 z-20 border border-gray-200 py-1 font-medium text-center ${dayHeaderClass(day)}`}
                    style={{ minWidth: 40 }}
                  >
                    <div>{dayNum}</div>
                    <div className="text-gray-400">{label}</div>
                    <div className="text-gray-400 font-normal">{count > 0 ? `${count}人` : ''}</div>
                  </th>
                )
              })}
              {showTotals && (
                <th className="sticky top-0 right-0 z-30 border border-blue-200 bg-blue-50 py-1 font-semibold text-center text-blue-700 whitespace-nowrap" style={{ minWidth: 52 }}>
                  合計
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {allWorkers.map((worker, wIdx) => {
              const isLastInGroup = wIdx === allWorkers.length - 1 ||
                allWorkers[wIdx + 1].company_name !== worker.company_name
              const companyName = worker.company_name ?? ''
              const companyTotal = isLastInGroup && showTotals
                ? allWorkers
                    .filter(w => (w.company_name ?? '') === companyName)
                    .reduce((sum, w) => sum + (workerDayCounts.get(w.id) ?? 0), 0)
                : 0

              return (
                <Fragment key={worker.id}>
                  <tr className="hover:bg-gray-50/50">
                    <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-1.5 whitespace-nowrap">
                      <div className="text-gray-400 text-xs leading-tight">{worker.company_name}</div>
                      <div className="font-medium text-gray-900">{worker.worker_name}</div>
                    </td>
                    {days.map((day, dIdx) => {
                      const report = reportMap.get(`${worker.id}_${day}`)
                      const isNight = report?.day_yakan_id === '105361'
                      const oh = report?.over_hour ?? 0
                      const selected = isCellSelected(wIdx, dIdx, selection)

                      return (
                        <td
                          key={day}
                          onMouseDown={e => handleCellMouseDown(wIdx, dIdx, e)}
                          onMouseEnter={() => handleCellMouseEnter(wIdx, dIdx)}
                          onMouseUp={() => handleCellMouseUp(wIdx, dIdx, worker, day)}
                          className={`border border-gray-200 cursor-pointer text-center p-0.5 h-9 ${dayHeaderClass(day)} ${selected ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                        >
                          {report && (
                            <div className="flex items-center justify-center gap-0.5 border border-gray-200 rounded px-0.5 h-full mx-0.5">
                              <span className="text-gray-700">
                                {isNight ? '●夜' : '●'}
                                {oh > 0 && <span className="text-gray-500">+{oh}</span>}
                              </span>
                            </div>
                          )}
                        </td>
                      )
                    })}
                    {showTotals && (
                      <td className="sticky right-0 z-10 border border-blue-200 bg-blue-50 text-center font-semibold text-blue-700 font-[tabular-nums]">
                        {workerDayCounts.get(worker.id) ?? 0}
                      </td>
                    )}
                  </tr>
                  {showTotals && isLastInGroup && (
                    <tr className="bg-blue-50/60">
                      <td className="sticky left-0 z-10 border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800 whitespace-nowrap" style={{ boxShadow: 'inset 3px 0 0 #2563EB' }}>
                        {companyName}　小計
                      </td>
                      {days.map(day => (
                        <td key={day} className="border border-blue-100 text-center text-xs text-blue-600 font-medium">
                          {(() => {
                            const cnt = allWorkers
                              .filter(w => (w.company_name ?? '') === companyName)
                              .filter(w => reportMap.has(`${w.id}_${day}`)).length
                            return cnt > 0 ? cnt : ''
                          })()}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 border border-blue-300 bg-blue-100 text-center font-bold text-blue-900 font-[tabular-nums]">
                        {companyTotal}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {showTotals && allWorkers.length > 0 && (
              <tr className="bg-blue-900">
                <td className="sticky left-0 z-10 border border-blue-700 bg-blue-900 px-3 py-1.5 text-xs font-bold text-blue-200 whitespace-nowrap tracking-widest">
                  月間総計
                </td>
                {days.map(day => {
                  const cnt = allWorkers.filter(w => reportMap.has(`${w.id}_${day}`)).length
                  return (
                    <td key={day} className="border border-blue-700 text-center text-xs font-medium text-blue-300">
                      {cnt > 0 ? cnt : ''}
                    </td>
                  )
                })}
                <td className="sticky right-0 z-10 border border-blue-500 bg-blue-700 text-center font-black text-white text-sm font-[tabular-nums]">
                  {[...workerDayCounts.values()].reduce((a, b) => a + b, 0)}
                </td>
              </tr>
            )}
            {allWorkers.length === 0 && (
              <tr>
                <td
                  colSpan={days.length + (showTotals ? 2 : 1)}
                  className="text-center py-10 text-gray-400"
                >
                  作業者がいません。「＋作業者を追加」か「CBOから取込」を実行してください。
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
          isAsbestos={isAsbestos}
          onClose={() => setEditing(null)}
          onSuccess={() => { setEditing(null); onRefresh() }}
        />
      )}

      {showBulkEdit && selection && (
        <BulkEditModal
          siteId={siteId}
          cells={bulkCells}
          isAsbestos={isAsbestos}
          onClose={() => setShowBulkEdit(false)}
          onSuccess={() => { setShowBulkEdit(false); setSelection(null); onRefresh() }}
        />
      )}

      {showAddModal && (
        <AddWorkerModal
          excludeWorkerIds={excludeIds}
          onAdd={workers => {
            setExtraWorkers(prev => [...prev, ...workers])
            setShowAddModal(false)
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
