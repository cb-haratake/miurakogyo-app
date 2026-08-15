import type { DailyReport } from './db'

export type WorkerSummary = {
  id: string
  source_kind: 'employee' | 'partner'
  company_name: string
  worker_name: string
  cbo_company_user_id: string | null
  cbo_supplier_id: string | null
  cbo_supplier_staff_id: string | null
}

export type ReportRow = DailyReport & {
  worker: WorkerSummary
  day_yakan: { id: string; label: string } | null
  work_content: { id: string; label: string } | null
  health_type: { id: string; label: string } | null
}

export type ReportRowWithSite = ReportRow & {
  site: { id: string; name: string; is_asbestos: boolean }
}
