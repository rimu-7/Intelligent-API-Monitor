"use client"

import { useCallback, useMemo, useState } from "react"
import {
  BellRingIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FilterXIcon,
  FlameIcon,
  RotateCwIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState, ErrorState, ResponsiveListSkeleton, StatCardSkeleton } from "@/components/common/states"
import { Pagination } from "@/components/common/pagination"
import { SectionHeader } from "@/components/common/section-header"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { SimulatorToolbar } from "@/components/dashboard/simulator/simulator-toolbar"
import { usePaginatedQuery } from "@/hooks/use-paginated-query"
import { api, type AlertQuery, type ApiAlert, type Severity } from "@/lib/api"
import { ms, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { AnomalyBadges, SeverityBadge, StatusBadge } from "./alert-badges"
import { AlertDialog, type AlertDialogMode } from "./alert-dialog"

type StatusFilter = "ACTIVE" | "RESOLVED" | "ALL"

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ACTIVE", label: "Active" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "ALL", label: "All" },
]

export function AlertsView() {
  const { summary, apis, tick, can, setSection } = useDashboard()
  const [status, setStatus] = useState<StatusFilter>("ACTIVE")
  const [severity, setSeverity] = useState<Severity | "">("")
  const [apiName, setApiName] = useState("")
  const [sort, setSort] = useState<"last_seen_at" | "severity">("last_seen_at")
  const [open, setOpen] = useState<{ alert: ApiAlert; mode: AlertDialogMode } | null>(null)

  const filters: Omit<AlertQuery, "limit" | "offset"> = useMemo(
    () => ({ status, severity: severity || undefined, api_name: apiName || undefined, sort }),
    [status, severity, apiName, sort]
  )
  const fetcher = useCallback((p: { limit: number; offset: number }) => api.listAlerts({ ...filters, ...p }), [filters])
  const q = usePaginatedQuery(fetcher, { resetKey: JSON.stringify(filters), refreshTick: tick, initialPageSize: 10 })

  const filtered = severity !== "" || apiName !== ""
  const clearFilters = () => {
    setSeverity("")
    setApiName("")
  }

  return (
    <div className="space-y-6">
      <StatCards />

      <SimulatorToolbar />

      <section className="space-y-4">
        <SectionHeader
          title="Incidents"
          description="Anomalies grouped per API, with root-cause analysis and suggested next steps."
          actions={
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => q.reload()} disabled={q.fetching}>
              <RotateCwIcon className={cn(q.fetching && "animate-spin")} />
            </Button>
          }
        />

        {/* Filters */}
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div role="tablist" aria-label="Status" className="inline-flex w-full rounded-lg bg-muted p-0.5 sm:w-auto">
            {STATUS_TABS.map((t) => {
              const count =
                t.value === "ACTIVE" ? summary?.active.total : t.value === "RESOLVED" ? summary?.resolved : undefined
              return (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={status === t.value}
                  onClick={() => setStatus(t.value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none",
                    status === t.value
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                  {count !== undefined && (
                    <span className="rounded-full bg-muted-foreground/10 px-1.5 text-[10px] tabular-nums">{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <NativeSelect
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity | "")}
              aria-label="Severity"
              className="w-full sm:w-36"
            >
              <NativeSelectOption value="">All severities</NativeSelectOption>
              <NativeSelectOption value="CRITICAL">Critical</NativeSelectOption>
              <NativeSelectOption value="WARNING">Warning</NativeSelectOption>
            </NativeSelect>
            <NativeSelect
              value={apiName}
              onChange={(e) => setApiName(e.target.value)}
              aria-label="Service"
              className="w-full sm:w-44"
            >
              <NativeSelectOption value="">All services</NativeSelectOption>
              {(apis ?? []).map((a) => (
                <NativeSelectOption key={a.name} value={a.name}>
                  {a.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              value={sort}
              onChange={(e) => setSort(e.target.value as "last_seen_at" | "severity")}
              aria-label="Sort"
              className="w-full sm:w-40"
            >
              <NativeSelectOption value="last_seen_at">Most recent</NativeSelectOption>
              <NativeSelectOption value="severity">Highest severity</NativeSelectOption>
            </NativeSelect>
            {filtered && (
              <Button variant="ghost" onClick={clearFilters}>
                <FilterXIcon /> Clear
              </Button>
            )}
          </div>
        </div>

        {q.loading ? (
          <ResponsiveListSkeleton rows={q.pageSize > 6 ? 6 : q.pageSize} columns={6} />
        ) : q.error && q.items.length === 0 ? (
          <ErrorState message={q.error} onRetry={() => q.reload()} />
        ) : q.items.length === 0 ? (
          <EmptyState
            icon={status === "ACTIVE" && !filtered ? ShieldCheckIcon : FilterXIcon}
            title={status === "ACTIVE" && !filtered ? "No active incidents" : "Nothing matches these filters"}
            description={
              status === "ACTIVE" && !filtered
                ? "Every monitored API is within its thresholds. Alerts close on their own after a quiet period."
                : "Try another status, severity or service."
            }
          >
            {filtered && (
              <Button variant="outline" onClick={clearFilters}>
                <FilterXIcon /> Clear filters
              </Button>
            )}
            {status === "ACTIVE" && (summary?.resolved ?? 0) > 0 && (
              <Button variant="outline" onClick={() => setStatus("RESOLVED")}>
                View {summary?.resolved} resolved
              </Button>
            )}
            {can("simulator:control") && status === "ACTIVE" && !filtered && (
              <Button variant="ghost" onClick={() => setSection("simulator")}>
                Open simulator <ChevronRightIcon />
              </Button>
            )}
          </EmptyState>
        ) : (
          <div className={cn("transition-opacity", q.fetching && "pointer-events-none opacity-60")}>
            <AlertTable alerts={q.items} onOpen={(alert, mode) => setOpen({ alert, mode })} />
            <AlertCards alerts={q.items} onOpen={(alert, mode) => setOpen({ alert, mode })} />
          </div>
        )}

        <Pagination
          page={q.page}
          pageCount={q.pageCount}
          pageSize={q.pageSize}
          total={q.total}
          onPageChange={q.setPage}
          onPageSizeChange={q.setPageSize}
          disabled={q.fetching}
          itemLabel="incidents"
        />
      </section>

      {open && (
        <AlertDialog
          key={open.alert.id}
          alert={open.alert}
          mode={open.mode}
          onModeChange={(mode) => setOpen((o) => (o ? { ...o, mode } : o))}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function StatCards() {
  const { summary, apis, liveConnected, stream } = useDashboard()
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    )
  }
  const busiest = summary.top_apis[0]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        icon={BellRingIcon}
        label="Active incidents"
        value={summary.active.total}
        hint={`${summary.active.critical} critical · ${summary.active.warning} warning`}
        tone={summary.active.total > 0 ? "text-red-500" : "text-emerald-500"}
      />
      <Stat
        icon={FlameIcon}
        label="Critical"
        value={summary.active.critical}
        hint={busiest ? `Most affected: ${busiest.api_name}` : "No service affected"}
        tone="text-orange-500"
      />
      <Stat
        icon={CheckCircle2Icon}
        label="Resolved"
        value={summary.resolved}
        hint="Manually or after a quiet period"
        tone="text-emerald-500"
      />
      <Stat
        icon={ServerIcon}
        label="Services"
        value={apis?.length ?? 0}
        hint={
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", liveConnected ? "bg-emerald-500" : "bg-amber-500")} />
            {liveConnected ? "Live" : "Reconnecting"}
            {stream?.streaming ? " · streaming" : ""}
          </span>
        }
        tone="text-sky-500"
      />
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  hint: React.ReactNode
  tone: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Icon className={cn("size-4", tone)} />
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value.toLocaleString()}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</div>
    </div>
  )
}

type OpenFn = (alert: ApiAlert, mode: AlertDialogMode) => void

function AlertTable({ alerts, onOpen }: { alerts: ApiAlert[]; onOpen: OpenFn }) {
  const { can } = useDashboard()
  return (
    <div className="hidden overflow-hidden rounded-lg border lg:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-[38%]">Service</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Anomalies</TableHead>
            <TableHead className="text-right">Peak</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead className="w-0 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((a) => (
            <TableRow key={a.id} className="cursor-pointer" onClick={() => onOpen(a, "details")}>
              <TableCell className="max-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.api_name}</span>
                  {a.status === "RESOLVED" && <StatusBadge alert={a} />}
                </div>
                <div className="truncate text-[11px] text-muted-foreground" title={a.alert_message}>
                  {a.alert_message}
                </div>
              </TableCell>
              <TableCell>
                <SeverityBadge severity={a.severity} />
              </TableCell>
              <TableCell>
                <AnomalyBadges types={a.anomaly_types} max={2} />
              </TableCell>
              <TableCell className="text-right font-mono text-[11px] tabular-nums">{ms(a.peak_response_time_ms)}</TableCell>
              <TableCell className="text-right font-mono text-[11px] tabular-nums">{a.occurrence_count}</TableCell>
              <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">{timeAgo(a.last_seen_at)}</TableCell>
              <TableCell className="text-right">
                {a.status === "ACTIVE" && can("alerts:resolve") ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(a, "resolve")
                    }}
                  >
                    Resolve
                  </Button>
                ) : (
                  <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AlertCards({ alerts, onOpen }: { alerts: ApiAlert[]; onOpen: OpenFn }) {
  const { can } = useDashboard()
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
      {alerts.map((a) => (
        <li key={a.id}>
          <article
            className={cn(
              "flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30",
              a.severity === "CRITICAL" && a.status === "ACTIVE" && "border-l-2 border-l-red-500"
            )}
          >
            <button type="button" className="space-y-2 text-left" onClick={() => onOpen(a, "details")}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="truncate text-sm font-medium">{a.api_name}</h3>
                <SeverityBadge severity={a.severity} />
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{a.alert_message}</p>
              <AnomalyBadges types={a.anomaly_types} max={3} />
            </button>
            <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
              <span className="tabular-nums">
                {a.occurrence_count}× · peak {ms(a.peak_response_time_ms)} · {timeAgo(a.last_seen_at)}
              </span>
              {a.status === "ACTIVE" && can("alerts:resolve") ? (
                <Button variant="outline" size="sm" onClick={() => onOpen(a, "resolve")}>
                  Resolve
                </Button>
              ) : (
                <StatusBadge alert={a} />
              )}
            </div>
          </article>
        </li>
      ))}
    </ul>
  )
}
