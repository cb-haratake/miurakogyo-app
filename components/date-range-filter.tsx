'use client'

import { useEffect, useRef, useState } from 'react'
import {
  RELATIVE_DATE_OPTION_ROWS,
  formatDateRangeLabel,
  resolveRelativeDateRange,
  type DateRange,
  type RelativeDateKey,
} from '@/lib/utils/date-range'

type Props = {
  value: DateRange
  onChange: (range: DateRange) => void
}

export function DateRangeFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'relative' | 'custom'>('relative')
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function selectRelative(key: RelativeDateKey) {
    onChange(resolveRelativeDateRange(key))
    setOpen(false)
  }

  function openPopover() {
    setCustomFrom(value.from)
    setCustomTo(value.to)
    setOpen(o => !o)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    onChange({ from: customFrom, to: customTo })
    setOpen(false)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={openPopover}
        className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white hover:bg-gray-50 whitespace-nowrap"
      >
        {formatDateRangeLabel(value)}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg w-72">
          <div className="flex border-b border-gray-200 text-sm">
            <button
              onClick={() => setTab('relative')}
              className={`flex-1 py-2 ${tab === 'relative' ? 'text-green-700 border-b-2 border-green-600 font-medium' : 'text-gray-500'}`}
            >
              相対日付
            </button>
            <button
              onClick={() => setTab('custom')}
              className={`flex-1 py-2 ${tab === 'custom' ? 'text-green-700 border-b-2 border-green-600 font-medium' : 'text-gray-500'}`}
            >
              カスタム
            </button>
          </div>

          {tab === 'relative' && (
            <div className="p-3 grid grid-cols-2 gap-x-3 gap-y-2">
              {RELATIVE_DATE_OPTION_ROWS.flatMap(([left, right], i) => [
                <label
                  key={left.key}
                  className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
                >
                  <input
                    type="radio"
                    name="relative-date"
                    onChange={() => selectRelative(left.key)}
                    className="w-3.5 h-3.5"
                  />
                  {left.label}
                </label>,
                right ? (
                  <label
                    key={right.key}
                    className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
                  >
                    <input
                      type="radio"
                      name="relative-date"
                      onChange={() => selectRelative(right.key)}
                      className="w-3.5 h-3.5"
                    />
                    {right.label}
                  </label>
                ) : (
                  <span key={`empty-${i}`} />
                ),
              ])}
            </div>
          )}

          {tab === 'custom' && (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
                />
                <span className="text-gray-400 text-sm">〜</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
                />
              </div>
              <button
                onClick={applyCustom}
                className="w-full bg-blue-600 text-white rounded py-1.5 text-sm hover:bg-blue-700"
              >
                適用
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
