import { createServerClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { listSites, listEmployees, listPartnerWorkers } from '@/lib/cbo/masters'
import { toSiteRow, toEmployeeRow, toPartnerWorkerRow } from '@/lib/cbo/normalize'
import type { WorkerRow } from '@/lib/cbo/normalize'

export type SyncMastersResult = {
  sites: { inserted: number; updated: number }
  workers: number
  errors: string[]
}

// target=employee | partner | (omit = all)
export async function syncMasters(
  target: string | null,
  triggerSource: 'user' | 'cron' = 'user'
): Promise<SyncMastersResult> {
  const user = await getAuthenticatedUser()
  const supabase = createServerClient()
  const now = new Date().toISOString()
  const result: SyncMastersResult = {
    sites: { inserted: 0, updated: 0 },
    workers: 0,
    errors: [],
  }

  // ===== 現場 ===== (target指定なしのみ)
  if (!target) {
    try {
      const cboSites = await listSites()
      const siteRows = cboSites.map(toSiteRow)

      // 既存 cbo_order_id を照合して新規 / 更新件数を計算
      const cboIds = siteRows.map(r => r.cbo_order_id)
      const { data: existing } = await supabase
        .from('sites')
        .select('cbo_order_id')
        .in('cbo_order_id', cboIds)
      const existingIds = new Set((existing ?? []).map(s => s.cbo_order_id))
      const insertedRows = siteRows.filter(r => !existingIds.has(r.cbo_order_id))
      const updatedRows = siteRows.filter(r => existingIds.has(r.cbo_order_id))

      const { error } = await supabase
        .from('sites')
        .upsert(siteRows, { onConflict: 'cbo_order_id' })

      if (error) throw new Error(error.message)

      // CBO に存在しなくなった現場を非活性化（削除ではなく is_active = false）
      // .select() で更新された行を取得し、詳細ログ用に非活性化した現場名を残す（追加の問い合わせなし）
      const { data: deactivatedRows, error: deactivateError } = await supabase
        .from('sites')
        .update({ is_active: false })
        .eq('is_active', true)
        .not('cbo_order_id', 'is', null)
        .not('cbo_order_id', 'in', `(${cboIds.join(',')})`)
        .select('name')

      if (deactivateError) throw new Error(deactivateError.message)

      result.sites = { inserted: insertedRows.length, updated: updatedRows.length }

      await supabase.from('sync_logs').insert({
        direction: 'pull', target: 'site',
        status: 'success',
        message: `新規${insertedRows.length}件・更新${updatedRows.length}件・非活性化${deactivatedRows?.length ?? 0}件`,
        payload_snapshot: {
          inserted: insertedRows.map(r => r.name),
          updated: updatedRows.map(r => r.name),
          deactivated: (deactivatedRows ?? []).map(r => r.name),
        },
        performed_by: user!.id, performed_at: now, trigger_source: triggerSource,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result.errors.push(`sites: ${msg}`)
      await supabase.from('sync_logs').insert({
        direction: 'pull', target: 'site',
        status: 'error', message: msg,
        performed_by: user!.id, performed_at: now, trigger_source: triggerSource,
      })
    }
  }

  // ===== 作業者 =====
  try {
    const [employees, partners] = await Promise.all([
      target !== 'partner' ? listEmployees() : Promise.resolve([]),
      target !== 'employee' ? listPartnerWorkers() : Promise.resolve([]),
    ])
    const workerRows: WorkerRow[] = [
      ...employees.map(toEmployeeRow),
      ...partners.map(toPartnerWorkerRow),
    ]

    // CBO レスポンスに同一キーの重複エントリが含まれる場合があるため除去
    // （重複があると ON CONFLICT DO UPDATE が同一行を2回更新しようとしてエラーになる）
    const seenEmployees = new Set<string>()
    const employeeRows = workerRows
      .filter((r): r is WorkerRow => r.source_kind === 'employee')
      .filter(r => {
        if (seenEmployees.has(r.cbo_company_user_id!)) return false
        seenEmployees.add(r.cbo_company_user_id!)
        return true
      })

    const seenPartners = new Set<string>()
    const partnerRows = workerRows
      .filter((r): r is WorkerRow => r.source_kind === 'partner')
      .filter(r => {
        const k = `${r.cbo_supplier_id}:${r.cbo_supplier_staff_id}`
        if (seenPartners.has(k)) return false
        seenPartners.add(k)
        return true
      })

    let newEmps: WorkerRow[] = []
    let updatedEmps: WorkerRow[] = []
    let deactivatedEmpNames: string[] = []
    let newPtrs: WorkerRow[] = []
    let updatedPtrs: WorkerRow[] = []
    let deactivatedPtrNames: string[] = []

    // 社員: 新規のみ is_active=true で挿入、既存は is_active を変えずに名前等を更新
    if (employeeRows.length) {
      const { data: existingEmps, error: empLookupErr } = await supabase
        .from('workers')
        .select('cbo_company_user_id')
        .eq('source_kind', 'employee')
        .in('cbo_company_user_id', employeeRows.map(r => r.cbo_company_user_id!))
      if (empLookupErr) throw new Error(empLookupErr.message)
      const existingEmpIds = new Set((existingEmps ?? []).map(r => r.cbo_company_user_id))

      newEmps = employeeRows.filter(r => !existingEmpIds.has(r.cbo_company_user_id!))
      updatedEmps = employeeRows.filter(r => existingEmpIds.has(r.cbo_company_user_id!))
      if (newEmps.length) {
        const { error } = await supabase.from('workers').insert(newEmps)
        if (error) throw new Error(error.message)
      }
      await Promise.all(
        updatedEmps
          .map(row => supabase.from('workers')
            .update({ worker_name: row.worker_name, company_name: row.company_name, name_kana: row.name_kana, tel: row.tel, last_synced_at: row.last_synced_at })
            .eq('cbo_company_user_id', row.cbo_company_user_id!)
            .then(({ error }) => { if (error) throw new Error(error.message) })
          )
      )
    }

    // 協力会社: 同様に is_active を保持して更新
    if (partnerRows.length) {
      const { data: existingPtrs, error: ptrLookupErr } = await supabase
        .from('workers')
        .select('cbo_supplier_id, cbo_supplier_staff_id')
        .eq('source_kind', 'partner')
        .in('cbo_supplier_staff_id', partnerRows.map(r => r.cbo_supplier_staff_id!))
      if (ptrLookupErr) throw new Error(ptrLookupErr.message)
      const existingPtrKeys = new Set(
        (existingPtrs ?? []).map(r => `${r.cbo_supplier_id}:${r.cbo_supplier_staff_id}`)
      )

      newPtrs = partnerRows.filter(r => !existingPtrKeys.has(`${r.cbo_supplier_id}:${r.cbo_supplier_staff_id}`))
      updatedPtrs = partnerRows.filter(r => existingPtrKeys.has(`${r.cbo_supplier_id}:${r.cbo_supplier_staff_id}`))
      if (newPtrs.length) {
        const { error } = await supabase.from('workers').insert(newPtrs)
        if (error) throw new Error(error.message)
      }
      await Promise.all(
        updatedPtrs
          .map(row => supabase.from('workers')
            .update({ worker_name: row.worker_name, company_name: row.company_name, last_synced_at: row.last_synced_at })
            .eq('cbo_supplier_id', row.cbo_supplier_id!)
            .eq('cbo_supplier_staff_id', row.cbo_supplier_staff_id!)
            .then(({ error }) => { if (error) throw new Error(error.message) })
          )
      )
    }

    // CBO に存在しなくなった作業者を非活性化（削除ではなく is_active = false）
    // target 指定がある場合はその種別のみ対象
    // .select() で更新された行を取得し、詳細ログ用に非活性化した氏名を残す（追加の問い合わせなし）
    if (target !== 'partner' && employeeRows.length) {
      const activeIds = employeeRows.map(r => r.cbo_company_user_id!)
      const { data: deactivated, error } = await supabase
        .from('workers')
        .update({ is_active: false })
        .eq('source_kind', 'employee')
        .eq('is_active', true)
        .not('cbo_company_user_id', 'in', `(${activeIds.join(',')})`)
        .select('worker_name')
      if (error) throw new Error(error.message)
      deactivatedEmpNames = (deactivated ?? []).map(r => r.worker_name)
    }
    if (target !== 'employee' && partnerRows.length) {
      // cbo_supplier_staff_id は会社内ローカルIDの可能性があるため
      // (cbo_supplier_id, cbo_supplier_staff_id) の複合キーで照合し、
      // 一致しないものを UUID 主キーで更新する
      const activeCboKeys = new Set(
        partnerRows.map(r => `${r.cbo_supplier_id}:${r.cbo_supplier_staff_id}`)
      )
      const { data: activeDbPartners } = await supabase
        .from('workers')
        .select('id, cbo_supplier_id, cbo_supplier_staff_id, worker_name')
        .eq('source_kind', 'partner')
        .eq('is_active', true)
      const toDeactivate = (activeDbPartners ?? [])
        .filter(p => !activeCboKeys.has(`${p.cbo_supplier_id}:${p.cbo_supplier_staff_id}`))
      if (toDeactivate.length) {
        const { error } = await supabase
          .from('workers')
          .update({ is_active: false })
          .in('id', toDeactivate.map(p => p.id))
        if (error) throw new Error(error.message)
        deactivatedPtrNames = toDeactivate.map(p => p.worker_name)
      }
    }

    result.workers = workerRows.length

    await supabase.from('sync_logs').insert({
      direction: 'pull', target: 'worker',
      status: 'success',
      message: `社員${employeeRows.length}件・協力会社${partnerRows.length}件（新規${newEmps.length + newPtrs.length}・更新${updatedEmps.length + updatedPtrs.length}・非活性化${deactivatedEmpNames.length + deactivatedPtrNames.length}）`,
      payload_snapshot: {
        employee: { new: newEmps.map(r => r.worker_name), deactivated: deactivatedEmpNames },
        partner: { new: newPtrs.map(r => r.worker_name), deactivated: deactivatedPtrNames },
      },
      performed_by: user!.id, performed_at: now, trigger_source: triggerSource,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    result.errors.push(`workers: ${msg}`)
    await supabase.from('sync_logs').insert({
      direction: 'pull', target: 'worker',
      status: 'error', message: msg,
      performed_by: user!.id, performed_at: now, trigger_source: triggerSource,
    })
  }

  return result
}
