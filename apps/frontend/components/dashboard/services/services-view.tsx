"use client"

import { useMemo, useState } from "react"
import { SearchIcon, ServerIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pagination } from "@/components/common/pagination"
import { SectionHeader } from "@/components/common/section-header"
import { EmptyState, ResponsiveListSkeleton } from "@/components/common/states"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import type { MonitoredApi } from "@/lib/api"
import { ms, percent, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

type SortKey = "alerts" | "name" | "errors" | "latency"

const SORTERS: Record<SortKey, (a: MonitoredApi, b: MonitoredApi) => number> = {
  alerts: (a, b) => b.active_alerts - a.active_alerts || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  errors: (a, b) => b.last_hour.error_rate - a.last_hour.error_rate || a.name.localeCompare(b.name),
  latency: (a, b) => (b.last_hour.p95_latency_ms ?? -1) - (a.last_hour.p95_latency_ms ?? -1),
}

export function ServicesView() {
  const { apis } = useDashboard()
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("alerts")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (apis ?? []).filter((a) => a.name.toLowerCase().includes(term)).sort(SORTERS[sort])
  }, [apis, search, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pageCount)
  const visible = rows.slice((current - 1) * pageSize, current * pageSize)

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Monitored services"
        description="Every API seen in telemetry, with last-hour traffic and the latency thresholds that trigger alerts."
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search services"
            aria-label="Search services"
            className="pl-8"
          />
        </div>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className="w-full sm:w-48">
          <NativeSelectOption value="alerts">Most active alerts</NativeSelectOption>
          <NativeSelectOption value="errors">Highest error rate</NativeSelectOption>
          <NativeSelectOption value="latency">Slowest (p95)</NativeSelectOption>
          <NativeSelectOption value="name">Name A–Z</NativeSelectOption>
        </NativeSelect>
      </div>

      {apis === null ? (
        <ResponsiveListSkeleton rows={6} columns={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={search ? SearchIcon : ServerIcon}
          title={search ? `No service matches “${search}”` : "No services yet"}
          description={search ? undefined : "Services appear here as soon as telemetry for them arrives."}
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border lg:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Requests (1h)</TableHead>
                  <TableHead className="text-right">Error rate</TableHead>
                  <TableHead className="text-right">p95 latency</TableHead>
                  <TableHead className="text-right">Thresholds</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">
                      {s.last_hour.requests.toLocaleString()}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-[11px] tabular-nums", errorTone(s.last_hour.error_rate))}>
                      {percent(s.last_hour.error_rate)}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-[11px] tabular-nums", latencyTone(s))}>
                      {ms(s.last_hour.p95_latency_ms)}
                    </TableCell>
                    <TableCell className="text-right text-[11px] text-muted-foreground tabular-nums">
                      {ms(s.latency_warning_ms)} / {ms(s.latency_critical_ms)}
                      {s.uses_default_thresholds && <span className="ml-1 opacity-70">(default)</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">{timeAgo(s.last_seen_at)}</TableCell>
                    <TableCell className="text-right">
                      <HealthBadge service={s} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {visible.map((s) => (
              <li key={s.name} className="space-y-3 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-medium">{s.name}</h3>
                  <HealthBadge service={s} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-[11px]">
                  <Metric label="Requests" value={s.last_hour.requests.toLocaleString()} />
                  <Metric label="Errors" value={percent(s.last_hour.error_rate)} className={errorTone(s.last_hour.error_rate)} />
                  <Metric label="p95" value={ms(s.last_hour.p95_latency_ms)} className={latencyTone(s)} />
                </dl>
                <div className="flex justify-between border-t pt-2 text-[11px] text-muted-foreground">
                  <span>
                    Thresholds {ms(s.latency_warning_ms)} / {ms(s.latency_critical_ms)}
                  </span>
                  <span>{timeAgo(s.last_seen_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination
        page={current}
        pageCount={pageCount}
        pageSize={pageSize}
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={(n) => {
          setPageSize(n)
          setPage(1)
        }}
        itemLabel="services"
      />
    </section>
  )
}

function HealthBadge({ service }: { service: MonitoredApi }) {
  if (service.active_alerts > 0) {
    return (
      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400">
        {service.active_alerts} active alert{service.active_alerts > 1 ? "s" : ""}
      </Badge>
    )
  }
  if (service.last_hour.requests === 0) {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Idle
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-500/30 text-[10px] text-emerald-700 dark:text-emerald-400">
      Healthy
    </Badge>
  )
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono font-medium tabular-nums", className)}>{value}</dd>
    </div>
  )
}

const errorTone = (rate: number) =>
  rate >= 0.1 ? "text-red-600 dark:text-red-400" : rate > 0 ? "text-amber-600 dark:text-amber-400" : ""

const latencyTone = (s: MonitoredApi) => {
  const p95 = s.last_hour.p95_latency_ms
  if (p95 === null) return ""
  if (p95 >= s.latency_critical_ms) return "text-red-600 dark:text-red-400"
  if (p95 >= s.latency_warning_ms) return "text-amber-600 dark:text-amber-400"
  return ""
}
