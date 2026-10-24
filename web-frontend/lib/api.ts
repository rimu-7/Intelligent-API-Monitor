// Typed client for the monitor API. All calls go through the Next.js rewrite (same origin),
// so the refresh-token cookie is sent automatically.

export type Role = "ADMIN" | "MANAGER"
export type Severity = "WARNING" | "CRITICAL"
export type AlertStatus = "ACTIVE" | "RESOLVED"

export interface ApiUser {
  id: string
  email: string
  role: Role
  is_active: boolean
  last_login_at?: string | null
  password_changed_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface ApiAlert {
  id: string
  api_name: string
  status: AlertStatus
  severity: Severity
  previous_severity?: string | null
  anomaly_types: string[]
  alert_message: string
  probable_cause?: string | null
  recommended_action?: string | null
  status_code?: number | null
  response_time_ms?: number | null
  records_returned?: number | null
  last_status_code?: number | null
  last_response_time_ms?: number | null
  last_records_returned?: number | null
  peak_response_time_ms?: number | null
  occurrence_count: number
  /** SKIPPED: rule-based text only; AI runs on request (saves tokens). */
  ai_status: "PENDING" | "COMPLETED" | "FALLBACK" | "SKIPPED"
  ai_provider: string | null
  ai_model?: string | null
  ai_generated_at?: string | null
  first_seen_at: string
  last_seen_at: string
  escalated_at?: string | null
  resolved_at?: string | null
  resolution_source?: "MANUAL" | "AUTO" | null
  resolution_note?: string | null
  created_at: string
}

export interface MonitoredApi {
  name: string
  latency_warning_ms: number
  latency_critical_ms: number
  expects_records: boolean
  uses_default_thresholds: boolean
  first_seen_at: string
  last_seen_at: string
  last_hour: {
    requests: number
    error_rate: number
    p95_latency_ms: number | null
  }
  active_alerts: number
}

export interface AuditLog {
  id: number
  actor_type: string
  actor_id?: string | null
  action: string
  target_type?: string | null
  target_id?: string | null
  metadata: Record<string, unknown>
  ip?: string | null
  request_id?: string | null
  created_at: string
}

export interface AlertSummary {
  active: { total: number; critical: number; warning: number }
  resolved: number
  top_apis: Array<{ api_name: string; active_alerts: number; critical: number }>
  generated_at: string
}

export interface StreamStatus {
  streaming: boolean
  interval_ms: number | null
  batch_size: number | null
  started_at: string | null
  stops_at: string | null
  batches_sent: number
  items_sent: number
  consecutive_failures: number
  last_error: string | null
  stopped_reason: string | null
}

export interface Scenario {
  name: string
  description: string
}

export interface NotificationSettings {
  alert_email_to: string[]
  source: "database" | "environment"
  email_enabled: boolean
  min_severity: Severity
  from: string
  smtp: { host: string | null; port: number; secure: boolean; auth_configured: boolean }
  updated_at: string | null
}

export interface TestEmailResult {
  delivered: true
  to: string[]
  message_id: string | null
  duration_ms: number
}

export interface ListMeta {
  total: number
  limit: number
  offset: number
}

export interface Page<T> {
  items: T[]
  meta: ListMeta
}

export interface PageParams {
  limit: number
  offset: number
}

// ─── Token storage ──────────────────────────────────────────────────────────

const TOKEN_KEY = "apimon_token"

const getStoredToken = (): string | null => {
  if (typeof window === "undefined") return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const setStoredToken = (token: string | null) => {
  if (typeof window === "undefined") return
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable (private mode); the session still works until reload */
  }
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number
  code?: string
  details?: unknown
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Human-readable message for any thrown value, including field-level validation errors. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
      const first = err.details[0] as { path?: string; message?: string } | undefined
      if (first?.message) {
        // "alert_email_to.1" → "alert email to #2"
        const where = (first.path ?? "").replace(/\.(\d+)$/, (_, i: string) => ` #${Number(i) + 1}`).replaceAll("_", " ")
        return where ? `${where}: ${first.message}` : first.message
      }
    }
    if (err.code === "RATE_LIMITED") return "Too many requests. Please wait a moment and try again."
    return err.message
  }
  if (err instanceof TypeError) return "Cannot reach the API. Check that the backend is running."
  if (err instanceof Error) return err.message
  return fallback
}

// ─── Session refresh ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let refreshing: Promise<boolean> | null = null

async function refreshOnce(): Promise<boolean> {
  const attempt = () => fetch("/api/v1/auth/refresh", { method: "POST", credentials: "include" })
  let res = await attempt()
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => null)
    if (body?.error?.code === "REFRESH_RACE") {
      // Another tab refreshed first; the shared cookie now holds the new token.
      await sleep(300)
      res = await attempt()
    }
  }
  if (!res.ok) {
    setStoredToken(null)
    return false
  }
  const body = await res.json().catch(() => null)
  const token: string | undefined = body?.data?.access_token
  setStoredToken(token ?? null)
  return Boolean(token)
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one refresh. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= refreshOnce().finally(() => {
    refreshing = null
  })
  return refreshing
}

// ─── Core request ───────────────────────────────────────────────────────────

interface Envelope<T> {
  data: T
  meta?: ListMeta
}

async function send<T>(endpoint: string, options: RequestInit = {}, retried = false): Promise<Envelope<T>> {
  const token = getStoredToken()
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) }
  if (options.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json"
  if (token) headers["Authorization"] = `Bearer ${token}`

  const response = await fetch(endpoint, { ...options, headers, credentials: "include", cache: "no-store" })
  const body = await response.json().catch(() => ({}))

  // Access tokens live 15 minutes: refresh once and retry instead of failing.
  const isAuthCall = endpoint.startsWith("/api/v1/auth/login") || endpoint.startsWith("/api/v1/auth/refresh")
  if (response.status === 401 && !retried && !isAuthCall) {
    const code = body?.error?.code
    if ((code === "TOKEN_EXPIRED" || code === "UNAUTHORIZED") && (await refreshSession())) {
      return send<T>(endpoint, options, true)
    }
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Request failed with status ${response.status}`
    throw new ApiError(message, response.status, body?.error?.code, body?.error?.details)
  }
  return { data: (body?.data !== undefined ? body.data : body) as T, meta: body?.meta }
}

const request = async <T>(endpoint: string, options?: RequestInit): Promise<T> => (await send<T>(endpoint, options)).data

const requestPage = async <T>(endpoint: string): Promise<Page<T>> => {
  const { data, meta } = await send<T[]>(endpoint)
  const items = Array.isArray(data) ? data : []
  return { items, meta: meta ?? { total: items.length, limit: items.length, offset: 0 } }
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value))
  }
  const s = query.toString()
  return s ? `?${s}` : ""
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

// ─── Endpoints ──────────────────────────────────────────────────────────────

export interface AlertQuery extends PageParams {
  status?: AlertStatus | "ALL"
  severity?: Severity
  api_name?: string
  sort?: "last_seen_at" | "severity"
}

export interface AuditQuery extends PageParams {
  action?: string
}

interface Session {
  access_token: string
  user: ApiUser
  permissions: string[]
}

export const api = {
  // Auth
  login: async (email: string, password: string) => {
    const res = await request<Session>("/api/v1/auth/login", {
      method: "POST",
      ...json({ email: email.trim().toLowerCase(), password }),
    })
    setStoredToken(res.access_token)
    return { user: res.user, permissions: res.permissions }
  },
  getMe: () => request<{ user: ApiUser; permissions: string[] }>("/api/v1/auth/me"),
  logout: async () => {
    try {
      await request("/api/v1/auth/logout", { method: "POST" })
    } finally {
      setStoredToken(null)
    }
  },
  /** Returns a fresh session (other sessions end), so the new token must be stored. */
  changePassword: async (payload: { current_password: string; new_password: string }) => {
    const res = await request<Session>("/api/v1/auth/change-password", { method: "POST", ...json(payload) })
    if (res?.access_token) setStoredToken(res.access_token)
  },

  // Alerts
  listAlerts: (q: AlertQuery) => requestPage<ApiAlert>(`/api/v1/alerts${qs({ ...q })}`),
  getAlert: (id: string) => request<ApiAlert>(`/api/v1/alerts/${encodeURIComponent(id)}`),
  getAlertSummary: () => request<AlertSummary>("/api/v1/alerts/summary"),
  resolveAlert: (id: string, note?: string) =>
    request<ApiAlert>(`/api/v1/alerts/${encodeURIComponent(id)}/resolve`, {
      method: "PATCH",
      ...json(note?.trim() ? { note: note.trim() } : {}),
    }),
  regenerateAi: (id: string) =>
    request<ApiAlert>(`/api/v1/alerts/${encodeURIComponent(id)}/regenerate`, { method: "POST" }),
  getStreamTicket: () =>
    request<{ ticket: string; expires_in: number }>("/api/v1/alerts/stream-ticket", { method: "POST" }),

  // Monitored APIs (the API returns the full list)
  listApis: () => request<MonitoredApi[]>("/api/v1/apis"),

  // Users
  listUsers: (q: PageParams & { role?: Role; is_active?: boolean }) =>
    requestPage<ApiUser>(`/api/v1/users${qs({ ...q })}`),
  createUser: (payload: { email: string; password: string; role: Role }) =>
    request<ApiUser>("/api/v1/users", { method: "POST", ...json(payload) }),
  updateUser: (id: string, payload: { role?: Role; is_active?: boolean }) =>
    request<ApiUser>(`/api/v1/users/${encodeURIComponent(id)}`, { method: "PATCH", ...json(payload) }),

  // Audit
  listAuditLogs: (q: AuditQuery) => requestPage<AuditLog>(`/api/v1/audit-logs${qs({ ...q })}`),

  // Simulator
  listScenarios: () => request<Scenario[]>("/api/v1/simulator/scenarios"),
  runScenario: (name: string) =>
    request<unknown>(`/api/v1/simulator/scenarios/${encodeURIComponent(name)}`, { method: "POST" }),
  getStreamStatus: () => request<StreamStatus>("/api/v1/simulator/stream/status"),
  startStream: (intervalMs = 2000, batchSize = 10) =>
    request<StreamStatus>("/api/v1/simulator/stream/start", {
      method: "POST",
      ...json({ interval_ms: intervalMs, batch_size: batchSize }),
    }),
  stopStream: () => request<StreamStatus>("/api/v1/simulator/stream/stop", { method: "POST" }),

  // Settings
  getNotificationSettings: () => request<NotificationSettings>("/api/v1/settings/notifications"),
  updateNotificationSettings: (recipients: string[]) =>
    request<NotificationSettings>("/api/v1/settings/notifications", {
      method: "PATCH",
      ...json({ alert_email_to: recipients }),
    }),
  sendTestEmail: (to?: string) =>
    request<TestEmailResult>("/api/v1/settings/notifications/test", {
      method: "POST",
      ...json(to ? { to } : {}),
    }),
}
