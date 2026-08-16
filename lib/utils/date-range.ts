export type RelativeDateKey =
  | 'yesterday'
  | 'today'
  | 'last_week'
  | 'this_week'
  | 'last_month'
  | 'this_month'
  | 'next_month'
  | 'last_quarter'
  | 'this_quarter'
  | 'last_half'
  | 'this_half'
  | 'last_year'
  | 'this_year'
  | 'before_today'

export type DateRange = { from: string; to: string }

type RelativeDateOption = { key: RelativeDateKey; label: string }

// 画面表示の2列レイアウトに対応するため、行ごとのペアで定義する（右側がない行は null）
export const RELATIVE_DATE_OPTION_ROWS: [RelativeDateOption, RelativeDateOption | null][] = [
  [{ key: 'yesterday', label: '昨日' }, { key: 'today', label: '今日' }],
  [{ key: 'last_week', label: '先週' }, { key: 'this_week', label: '今週' }],
  [{ key: 'last_month', label: '先月' }, { key: 'this_month', label: '今月' }],
  [{ key: 'next_month', label: '来月' }, null],
  [{ key: 'last_quarter', label: '前四半期' }, { key: 'this_quarter', label: '今四半期' }],
  [{ key: 'last_half', label: '前半期' }, { key: 'this_half', label: '今半期' }],
  [{ key: 'last_year', label: '去年' }, { key: 'this_year', label: '今年' }],
  [{ key: 'before_today', label: '今日より前' }, null],
]

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(d: Date, delta: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + delta)
  return r
}

// 週の始まりは月曜日
function startOfWeek(d: Date): Date {
  const diff = (d.getDay() + 6) % 7
  return addDays(d, -diff)
}

function monthRange(year: number, month0: number): DateRange {
  const from = new Date(year, month0, 1)
  const to = new Date(year, month0 + 1, 0)
  return { from: toISODate(from), to: toISODate(to) }
}

// 四半期・半期は4月始まりの年度で計算する
function fiscalYearOf(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}

function quarterRange(fiscalYear: number, quarterIndex: number): DateRange {
  // quarterIndex: 0=4-6月, 1=7-9月, 2=10-12月, 3=1-3月
  const startMonth0 = 3 + quarterIndex * 3
  const from = new Date(fiscalYear, startMonth0, 1)
  const to = new Date(fiscalYear, startMonth0 + 3, 0)
  return { from: toISODate(from), to: toISODate(to) }
}

function halfRange(fiscalYear: number, halfIndex: number): DateRange {
  // halfIndex: 0=4-9月, 1=10-3月
  const startMonth0 = halfIndex === 0 ? 3 : 9
  const from = new Date(fiscalYear, startMonth0, 1)
  const to = new Date(fiscalYear, startMonth0 + 6, 0)
  return { from: toISODate(from), to: toISODate(to) }
}

export function resolveRelativeDateRange(key: RelativeDateKey): DateRange {
  const today = new Date()
  const fy = fiscalYearOf(today)
  const quarterIndex = Math.floor((today.getMonth() - 3 + 12) % 12 / 3)
  const halfIndex = (today.getMonth() - 3 + 12) % 12 < 6 ? 0 : 1

  switch (key) {
    case 'yesterday': {
      const d = toISODate(addDays(today, -1))
      return { from: d, to: d }
    }
    case 'today': {
      const d = toISODate(today)
      return { from: d, to: d }
    }
    case 'last_week': {
      const start = addDays(startOfWeek(today), -7)
      return { from: toISODate(start), to: toISODate(addDays(start, 6)) }
    }
    case 'this_week': {
      const start = startOfWeek(today)
      return { from: toISODate(start), to: toISODate(addDays(start, 6)) }
    }
    case 'last_month':
      return monthRange(today.getFullYear(), today.getMonth() - 1)
    case 'this_month':
      return monthRange(today.getFullYear(), today.getMonth())
    case 'next_month':
      return monthRange(today.getFullYear(), today.getMonth() + 1)
    case 'last_quarter':
      return quarterIndex === 0 ? quarterRange(fy - 1, 3) : quarterRange(fy, quarterIndex - 1)
    case 'this_quarter':
      return quarterRange(fy, quarterIndex)
    case 'last_half':
      return halfIndex === 0 ? halfRange(fy - 1, 1) : halfRange(fy, 0)
    case 'this_half':
      return halfRange(fy, halfIndex)
    case 'last_year':
      return { from: `${today.getFullYear() - 1}-01-01`, to: `${today.getFullYear() - 1}-12-31` }
    case 'this_year':
      return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` }
    case 'before_today':
      return { from: '1900-01-01', to: toISODate(addDays(today, -1)) }
  }
}

export function formatDateRangeLabel(range: DateRange): string {
  const f = (s: string) => {
    const [y, m, d] = s.split('-')
    return `${y}/${Number(m)}/${Number(d)}`
  }
  if (range.from === range.to) return f(range.from)
  if (range.from === '1900-01-01') return `${f(range.to)}まで`
  return `${f(range.from)} 〜 ${f(range.to)}`
}
