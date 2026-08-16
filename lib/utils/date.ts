import HolidayJP from '@holiday-jp/holiday_jp'

export function getDaysInMonth(yearMonth: string): string[] {
  const [year, month] = yearMonth.split('-').map(Number)
  const days: string[] = []
  const d = new Date(year, month - 1, 1)
  while (d.getMonth() === month - 1) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    days.push(`${y}-${m}-${day}`)
    d.setDate(d.getDate() + 1)
  }
  return days
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

export function getDayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return { day: d.getDay(), label: WEEK[d.getDay()] }
}

export function isHoliday(dateStr: string): boolean {
  try {
    return HolidayJP.isHoliday(new Date(dateStr + 'T00:00:00'))
  } catch {
    return false
  }
}

export function dayHeaderClass(dateStr: string): string {
  const day = new Date(dateStr + 'T00:00:00').getDay()
  if (day === 0 || isHoliday(dateStr)) return 'bg-red-50 text-red-600'
  if (day === 6) return 'bg-blue-50 text-blue-600'
  return ''
}

export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `${y}年${m}月`
}

export function todayYearMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 60) return 'たった今'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}日前`
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
