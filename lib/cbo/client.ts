// CBO API 共通 HTTP クライアント（サーバー専用）
// CBO_TOKEN はサーバー側シークレット。このモジュールをクライアントバンドルに含めてはいけない

const BASE_URL = process.env.CBO_BASE_URL ?? 'https://office.craft-bank.com/api'

// GAS実装に倣い連続呼び出しは 500ms 間隔を空ける
const THROTTLE_MS = 500
let lastCallAt = 0

// throttle()は並列呼び出しされる（sync/push等）ため、素朴に lastCallAt を
// 読み書きするだけだと複数呼び出しが同じ待ち時間を計算してしまい、待機後に
// 一斉発火（バースト）してしまう。Promiseチェーンで直列化し、常に「直前の
// 呼び出しが実際に許可された時刻」から500ms空けることを保証する。
let throttleChain: Promise<void> = Promise.resolve()

function throttle(): Promise<void> {
  const gate = throttleChain.then(async () => {
    const elapsed = Date.now() - lastCallAt
    if (elapsed < THROTTLE_MS) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS - elapsed))
    }
    lastCallAt = Date.now()
  })
  throttleChain = gate.catch(() => {})
  return gate
}

export class CboApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
    path: string
  ) {
    super(`CBO API ${status}: ${path}`)
    this.name = 'CboApiError'
  }
}

export async function cboFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = process.env.CBO_TOKEN
  if (!token) throw new Error('CBO_TOKEN が未設定です')

  await throttle()

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new CboApiError(res.status, body, path)
  }

  return res.json() as Promise<T>
}
