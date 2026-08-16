'use client'

import type { SyncLog } from '@/types/db'

const TARGET_LABEL: Record<SyncLog['target'], string> = {
  site: '現場',
  worker: '作業者',
  report: '出面',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-20 shrink-0 text-gray-400">{label}</span>
      <span className="text-gray-800 break-all">{value}</span>
    </div>
  )
}

type Props = {
  log: SyncLog
  onClose: () => void
}

export function SyncLogDetailModal({ log, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-900">同期ログ詳細</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-2 mb-4">
          <Row label="日時" value={new Date(log.performed_at).toLocaleString('ja-JP')} />
          <Row label="トリガー元" value={log.trigger_source === 'cron' ? '自動（CRON）' : '手動'} />
          <Row label="方向" value={log.direction === 'pull' ? '取込（CBO→アプリ）' : '反映（アプリ→CBO）'} />
          <Row label="対象" value={TARGET_LABEL[log.target]} />
          <Row label="状態" value={log.status === 'success' ? '成功' : 'エラー'} />
          {log.record_id && <Row label="レコードID" value={log.record_id} />}
          {log.cbo_report_id && <Row label="CBO報告ID" value={log.cbo_report_id} />}
        </div>

        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1">メッセージ</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded p-2 border border-gray-200">
            {log.message || '—'}
          </p>
        </div>

        {log.payload_snapshot != null && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">送受信データ</p>
            <pre className="text-xs bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(log.payload_snapshot, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
