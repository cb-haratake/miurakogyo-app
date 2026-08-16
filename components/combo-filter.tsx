'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder: string
  allLabel: string
  className?: string
}

export function ComboFilter({ value, onChange, options, placeholder, allLabel, className }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const filteredOptions = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options
    return options.filter(o => o.toLowerCase().includes(q))
  }, [options, value])

  return (
    <div className={`relative ${className ?? ''}`} ref={rootRef}>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded shadow-lg w-full max-h-56 overflow-y-auto">
          <button
            onClick={() => { onChange(''); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
          >
            {allLabel}
          </button>
          {filteredOptions.map(o => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 truncate"
            >
              {o}
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-gray-400">一致する項目がありません</p>
          )}
        </div>
      )}
    </div>
  )
}
