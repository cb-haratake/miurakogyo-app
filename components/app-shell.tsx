'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
  return (
    <Link
      href={href}
      className={`block px-3 py-2 rounded text-sm transition-colors ${
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
      }`}
    >
      {label}
    </Link>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true)       // PC: インフロー表示
  const [mobileOpen, setMobileOpen] = useState(false) // 携帯: オーバーレイドロワー

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* PC用折りたたみレール */}
      {!isOpen && (
        <div className="w-8 bg-gray-900 hidden md:flex flex-col items-center pt-3 shrink-0">
          <button
            onClick={() => setIsOpen(true)}
            className="text-gray-400 hover:text-white"
            aria-label="メニューを開く"
          >
            »
          </button>
        </div>
      )}

      {/* 携帯ドロワー表示時のバックドロップ */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`w-52 bg-gray-900 flex-col shrink-0 fixed inset-y-0 left-0 z-40 md:static md:z-auto ${
          mobileOpen ? 'flex' : 'hidden'
        } ${isOpen ? 'md:flex' : 'md:hidden'}`}
      >
        <div className="px-4 py-3 border-b border-gray-700 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400">三浦興業</p>
            <p className="text-white font-semibold text-sm mt-0.5">出面・石綿記録</p>
          </div>
          <button
            onClick={() => { setIsOpen(false); setMobileOpen(false) }}
            className="text-gray-400 hover:text-white px-1"
            aria-label="メニューを閉じる"
          >
            «
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-0.5" onClick={() => setMobileOpen(false)}>
          <NavItem href="/" label="現場一覧" />
          <NavItem href="/reports" label="出面一覧" />
          <NavItem href="/masters" label="マスタ管理" />
          <NavItem href="/manual" label="操作マニュアル" />
          <a
            href="https://office.craft-bank.com/orders?custom_view_id=8440&per_page=100&sort_asc_desc=desc&sort_key=latest_updated_at"
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 rounded text-sm transition-colors text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            ホーム
          </a>
        </nav>
        <div className="p-2 border-t border-gray-700" onClick={() => setMobileOpen(false)}>
          <NavItem href="/sync" label="同期・ログ" />
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 携帯用トップバー */}
        <div className="md:hidden flex items-center gap-2 bg-gray-900 px-3 py-2 shrink-0 print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-gray-300 hover:text-white text-lg leading-none px-1"
            aria-label="メニューを開く"
          >
            ☰
          </button>
          <span className="text-white font-semibold text-sm">出面・石綿記録</span>
        </div>
        {/* ページ側は h-full を使っているため、携帯用トップバー分の高さを引いた
            残り領域として flex-1 で確保する（h-full のままだと親全体の高さと
            衝突し、モバイルでは下端がトップバーの分だけ見切れてしまう） */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}
