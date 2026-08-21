// CBO 読み取りアダプタ（サーバー専用）
// 参照: CBO_API連携仕様 §8
// T2.0疎通確認で判明した実際のレスポンス構造に基づく実装

import { cboFetch } from './client'

// ===== 正規化後の型 =====

export type CboSite = {
  cboOrderId: string
  name: string
  clientName: string | null
  managerName: string | null
  status: string | null
  isAsbestos: boolean
  periodStart: string | null
  periodEnd: string | null
}

export type CboEmployee = {
  cboCompanyUserId: string
  workerName: string
  nameKana: string | null
  tel: string | null
}

export type CboPartnerWorker = {
  cboSupplierId: string
  cboSupplierStaffId: string
  companyName: string
  workerName: string
}

export type CboReport = {
  cboReportId: string
  cboOrderId: string
  cboOrderName: string | null     // onsite.label（現場名フィルタに使用）
  date: string
  dayYakanId: string | null
  overHour: number
  workContentId: string | null
  healthTypeId: string | null
  companyUserId: string | null    // 自社員: work_user キーの値
  supplierId: string | null       // 外注: sup_name キーの値 (supplier id)
  supplierStaffId: string | null  // 外注: sup_staff キーの値 (staff id)
}

// ===== 内部ユーティリティ =====

type CboValue = { key: string; value: unknown; label: string }

function extractVal(values: CboValue[], key: string): unknown {
  return values.find((v) => v.key === key)?.value ?? null
}

function extractLabel(values: CboValue[], key: string): string | null {
  const label = values.find((v) => v.key === key)?.label
  return label != null && label !== '' ? label : null
}

function str(v: unknown): string | null {
  return v != null && v !== '' ? String(v) : null
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0
}

// ===== 現場一覧 =====
// 実レスポンス: { data: [{ id, title, order_format_id, values: [{key, value, label}], status }] }
// 現場名は title（CBO画面で変更されるフィールド）を優先し、空の場合は contract_name にフォールバック

export async function listSites(): Promise<CboSite[]> {
  const viewId = process.env.CBO_ORDER_VIEW_ID ?? '8440'

  type OrderItem = { id: number; title?: string; values: CboValue[]; status?: { name: string } }
  const allOrders: OrderItem[] = []
  let page = 1
  let lastPage = 1

  do {
    const res = await cboFetch<{
      data: OrderItem[]
      meta?: { last_page: number }
    }>(`/order_custom_views/${viewId}/orders?per_page=100&page=${page}`)
    allOrders.push(...(res.data ?? []))
    lastPage = res.meta?.last_page ?? 1
    page++
  } while (page <= lastPage)

  return allOrders.map((o) => {
    const asbests = extractVal(o.values, 'asbests')
    const name = o.title?.trim()
      || String(extractVal(o.values, 'contract_name') ?? '').trim()
    return {
      cboOrderId: String(o.id),
      name,
      clientName: extractLabel(o.values, 'suppliers_name'),
      managerName: extractLabel(o.values, 'order_staff'),
      status: o.status?.name ?? null,
      isAsbestos: asbests !== null && asbests !== undefined && asbests !== '',
      periodStart: str(extractVal(o.values, 'start_date_man')),
      periodEnd: str(extractVal(o.values, 'end_date_man')),
    }
  })
}

// ===== 社員一覧 =====
// 実レスポンス: { data: [{ id, full_name, full_name_kana, tel, withdrawn_at, ... }], meta: { last_page } }

export async function listEmployees(): Promise<CboEmployee[]> {
  type UserItem = Record<string, unknown>
  const allUsers: UserItem[] = []
  let page = 1
  let lastPage = 1

  do {
    const res = await cboFetch<{
      data: UserItem[]
      meta?: { last_page: number }
    }>(`/users?per_page=100&page=${page}`)
    allUsers.push(...(res.data ?? []))
    lastPage = res.meta?.last_page ?? 1
    page++
  } while (page <= lastPage)

  return allUsers
    .filter((u) => !u['is_withdrawed'] && !u['withdrawn_at'] && !u['deleted_at'])
    .map((u) => ({
      cboCompanyUserId: String(u['id']),
      workerName: String(u['full_name'] ?? ''),
      nameKana: str(u['full_name_kana']),
      tel: str(u['tel']),
    }))
}

// ===== 協力会社＋担当者一覧 =====
// 一覧: GET /supplier_custom_views/{viewId}/suppliers → format_id=5307 の ID を収集
// 詳細: GET /supplier_trees/{id}?evaluate_expression=0 → tree 構造でスタッフ個別 ID 取得
// tree.children: general_information > name (社名)
//                staff_information > staff (repeatable box) > staff_name > staff_last_name / staff_first_name
// cbo_supplier_id = 一覧の supplier.id (319097)
// cbo_supplier_staff_id = staff.value[i].id (7994989, 7994992...)

// ---- 内部型 ----

type TreeVal = {
  id: number
  parent_id: number | null
  key: string
  value: unknown
}

type TreeNode = {
  id: number
  key: string
  value: TreeVal[]
  children?: TreeNode[]
}

function findTreeNode(node: TreeNode, key: string): TreeNode | null {
  if (node.key === key) return node
  for (const child of node.children ?? []) {
    const found = findTreeNode(child, key)
    if (found) return found
  }
  return null
}

export async function listPartnerWorkers(): Promise<CboPartnerWorker[]> {
  const viewId = process.env.CBO_SUPPLIER_VIEW_ID ?? '3107'

  // 1. 一覧から format_id=5307 の supplier ID を収集
  type SupplierListItem = { format_id: number; id: number }
  const supplierIds: number[] = []
  let page = 1
  let lastPage = 1

  do {
    const res = await cboFetch<{
      data: SupplierListItem[]
      meta: { last_page: number }
    }>(`/supplier_custom_views/${viewId}/suppliers?per_page=100&page=${page}`)
    for (const s of res.data ?? []) {
      if (s.format_id === 5307) supplierIds.push(s.id)
    }
    lastPage = res.meta?.last_page ?? 1
    page++
  } while (page <= lastPage)

  // 2. 各社の詳細 (tree) を取得してスタッフを展開
  const workers: CboPartnerWorker[] = []

  for (const supplierId of supplierIds) {
    let detail: { data: { id: number; tree: TreeNode } }
    try {
      detail = await cboFetch<{ data: { id: number; tree: TreeNode } }>(
        `/supplier_trees/${supplierId}?evaluate_expression=0`
      )
    } catch {
      // CBO が 500 などを返した場合はこの会社をスキップして続行
      continue
    }

    const tree = detail.data?.tree
    if (!tree) continue

    // 社名
    const nameNode = findTreeNode(tree, 'name')
    const companyName = str(nameNode?.value?.[0]?.value)
    if (!companyName) continue

    // スタッフ instances
    const staffNode = findTreeNode(tree, 'staff')
    if (!staffNode?.value?.length) continue

    const staffNameNode = findTreeNode(staffNode, 'staff_name')
    const staffLastNode = findTreeNode(staffNode, 'staff_last_name')
    const staffFirstNode = findTreeNode(staffNode, 'staff_first_name')

    for (const staffInst of staffNode.value) {
      const staffId = staffInst.id
      // staff_name value に parent_id = staffId のものを探す
      const snVal = staffNameNode?.value?.find((v) => v.parent_id === staffId)
      if (!snVal) continue

      const lastName = str(staffLastNode?.value?.find((v) => v.parent_id === snVal.id)?.value) ?? ''
      const firstName = str(staffFirstNode?.value?.find((v) => v.parent_id === snVal.id)?.value) ?? ''
      const workerName = `${lastName}${firstName}`.trim()
      if (!workerName) continue

      workers.push({
        cboSupplierId: String(supplierId),
        cboSupplierStaffId: String(staffId),
        companyName,
        workerName,
      })
    }
  }

  return workers
}

// ===== 出面一覧 =====
// 実レスポンス確認（T2.0疎通）:
//   リスト GET /personal_daily_reports?format_id=4879&... → { data: [{ id, date, name, ... }] }
//     ※ values は含まれない。id のみ有用。
//   詳細 GET /personal_daily_reports/{id} → { data: { id, tree: ReportNode } }
//     tree: root > report_section > [start_date, onsite, work_user, sup_name, sup_staff,
//                                    day_yakan, over_hour, work_content, health_type]
//   自社員: work_user.value[0].value = company_user_id (number)
//   協力会社: sup_name.value[0].value = supplier_id, sup_staff.value[0].value = staff_id
//   日付: start_date.value[0].label = "YYYY-MM-DD" (value は UTC datetime)

type ReportVal = {
  id: number
  parent_id: number | null
  key: string
  value: unknown
  label: string | null
}

type ReportNode = {
  id: number
  key: string
  value: ReportVal[]
  children?: ReportNode[]
}

function findReportNode(node: ReportNode, key: string): ReportNode | null {
  if (node.key === key) return node
  for (const child of node.children ?? []) {
    const found = findReportNode(child, key)
    if (found) return found
  }
  return null
}

// siteName: DB の sites.name（リストの order_titles と照合してフィルタ）
// order_id フィルタは CBO 内部 ID の不一致で誤データを引くため使わない
// 方式: リスト1〜N ページ取得 → order_titles で現場名絞り込み → 絞り込んだ件数分だけ詳細API
export async function listAttendanceReports(
  siteName: string,
  period: { from: string; to: string }
): Promise<CboReport[]> {
  // 1. リスト全件取得（ページネーション対応）
  type ListItem = { id: number; order_titles: string[] }
  const allItems: ListItem[] = []
  let page = 1
  let lastPage = 1

  do {
    const params = new URLSearchParams({
      format_id: '4879',
      from: period.from,
      to: period.to,
      per_page: '100',
      page: String(page),
    })
    const res = await cboFetch<{
      data: ListItem[]
      meta?: { last_page: number }
    }>(`/personal_daily_reports?${params}`)
    allItems.push(...(res.data ?? []))
    lastPage = res.meta?.last_page ?? 1
    page++
  } while (page <= lastPage)

  // 2. order_titles で現場名フィルタ（詳細API呼び出し前に絞り込む）
  const trimmedName = siteName.trim()
  const matched = allItems.filter(item =>
    item.order_titles?.some(t => t.trim() === trimmedName)
  )

  // 3. 絞り込んだ件数分だけ詳細API呼び出し → tree から正規化
  // 件数が多いと逐次呼び出しは時間がかかるため、仕様書が許容する範囲（並列1〜2）で並列化する
  const DETAIL_CONCURRENCY = 2
  const reports: CboReport[] = []
  for (let i = 0; i < matched.length; i += DETAIL_CONCURRENCY) {
    const chunk = matched.slice(i, i + DETAIL_CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async item => {
        try {
          const detail = await cboFetch<{ data: { id: number; tree: ReportNode } }>(
            `/personal_daily_reports/${item.id}`
          )
          return normalizeDetailReport(detail.data)
        } catch {
          return null
        }
      })
    )
    reports.push(...results.filter((r): r is CboReport => r !== null))
  }
  return reports
}

// ===== 出面単体 =====

export async function getAttendanceReport(reportId: string): Promise<CboReport> {
  const res = await cboFetch<{ data: { id: number; tree: ReportNode } }>(
    `/personal_daily_reports/${reportId}`
  )
  return normalizeDetailReport(res.data)
}

// ===== 内部: 出面詳細レスポンス正規化 =====

function normalizeDetailReport(r: { id: number; tree: ReportNode }): CboReport {
  const tree = r.tree
  const getVal = (key: string): unknown =>
    findReportNode(tree, key)?.value?.[0]?.value ?? null
  const getLabel = (key: string): string | null =>
    findReportNode(tree, key)?.value?.[0]?.label ?? null

  return {
    cboReportId: String(r.id),
    cboOrderId: String(getVal('onsite') ?? ''),
    cboOrderName: getLabel('onsite'),    // 現場名フィルタ用
    date: getLabel('start_date') ?? '',  // label="YYYY-MM-DD", value=UTC datetime
    dayYakanId: str(getVal('day_yakan')),
    overHour: num(getVal('over_hour')),
    workContentId: str(getVal('work_content')),
    healthTypeId: str(getVal('health_type')),
    companyUserId: str(getVal('work_user')),    // 自社員: work_user キー
    supplierId: str(getVal('sup_name')),
    supplierStaffId: str(getVal('sup_staff')),
  }
}

// デバッグ用: CBO 出面の生レスポンスをそのまま返す（診断後に削除）
export async function listAttendanceReportsRaw(
  orderId: string,
  period: { from: string; to: string }
): Promise<{ listSample: unknown; detailSample: unknown }> {
  const params = new URLSearchParams({
    format_id: '4879',
    order_id: orderId,
    from: period.from,
    to: period.to,
  })
  const res = await cboFetch<{ data: Array<Record<string, unknown>> }>(
    `/personal_daily_reports?${params}`
  )
  const firstId = res.data[0]?.id as number | undefined
  let detail: unknown = null
  if (firstId) {
    detail = await cboFetch(`/personal_daily_reports/${firstId}`)
  }
  return { listSample: res.data[0] ?? null, detailSample: detail }
}
