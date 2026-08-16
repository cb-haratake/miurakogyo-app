export type SyncStatus = 'local_new' | 'synced' | 'local_edited' | 'conflict'
export type WorkerSource = 'employee' | 'partner'

export type Site = {
  id: string
  cbo_order_id: string
  name: string
  client_name: string | null
  manager_name: string | null
  cbo_status: string | null
  is_asbestos: boolean
  period_start: string | null
  period_end: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export type Worker = {
  id: string
  source_kind: WorkerSource
  cbo_company_user_id: string | null
  cbo_supplier_id: string | null
  cbo_supplier_staff_id: string | null
  company_name: string
  worker_name: string
  name_kana: string | null
  tel: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type DailyReport = {
  id: string
  site_id: string
  worker_id: string
  work_date: string
  reporter_cbo_user_id: string | null
  day_yakan_id: string | null
  over_hour: number
  work_content_id: string | null
  health_type_id: string | null
  is_corrected: boolean
  cbo_report_id: string | null
  sync_status: SyncStatus
  cbo_synced_at: string | null
  created_at: string
  updated_at: string
}

export type SyncLog = {
  id: string
  direction: 'pull' | 'push'
  target: 'site' | 'worker' | 'report'
  record_id: string | null
  cbo_report_id: string | null
  status: 'success' | 'error'
  message: string | null
  payload_snapshot: unknown
  performed_by: string | null
  performed_at: string
  trigger_source: 'user' | 'cron'
}
