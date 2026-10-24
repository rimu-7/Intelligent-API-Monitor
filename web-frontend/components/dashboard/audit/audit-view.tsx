"use client"

import { useCallback, useState } from "react"
import { FileTextIcon, RotateCwIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pagination } from "@/components/common/pagination"
import { SectionHeader } from "@/components/common/section-header"
import { EmptyState, ErrorState, ResponsiveListSkeleton } from "@/components/common/states"
import { usePaginatedQuery } from "@/hooks/use-paginated-query"
import { api, type AuditLog } from "@/lib/api"
import { dateTime, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

const ACTIONS = [
  "auth.login.success",
  "auth.login.failure",
  "auth.logout",
  "auth.password_changed",
  "auth.refresh_reuse_detected",
  "user.created",
  "user.role_changed",
  "user.deactivated",
  "user.reactivated",
  "alert.resolved",
  "alert.regenerated",
  "api.thresholds_changed",
  "settings.notifications_changed",
  "settings.test_email_sent",
]

const tone = (action: string) =>
  action.includes("failure") || action.includes("reuse") || action.includes("deactivated")
    ? "border-red-500/30 text-red-600 dark:text-red-400"
    : action.startsWith("settings") || action.includes("role") || action.includes("password")
      ? "border-amber-500/30 text-amber-700 dark:text-amber-400"
      : ""

const target = (log: AuditLog) =>
  log.target_type ? `${log.target_type}${log.target_id ? ` · ${log.target_id.length > 12 ? `${log.target_id.slice(0, 8)}…` : log.target_id}` : ""}` : "—"

const actor = (log: AuditLog) =>
  log.actor_type === "user" && log.actor_id ? `user · ${log.actor_id.slice(0, 8)}…` : log.actor_type

export function AuditView() {
  const [action, setAction] = useState("")
  const fetcher = useCallback(
    (p: { limit: number; offset: number }) => api.listAuditLogs({ ...p, action: action || undefined }),
    [action]
  )
  const q = usePaginatedQuery(fetcher, { resetKey: action, initialPageSize: 20 })

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Audit log"
        description="Sign-ins, permission changes, resolutions and settings changes, newest first."
        actions={
          <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => q.reload()} disabled={q.fetching}>
            <RotateCwIcon className={cn(q.fetching && "animate-spin")} />
          </Button>
        }
      />

      <NativeSelect value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" className="w-full sm:w-64">
        <NativeSelectOption value="">All events</NativeSelectOption>
        {ACTIONS.map((a) => (
          <NativeSelectOption key={a} value={a}>
            {a}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      {q.loading ? (
        <ResponsiveListSkeleton rows={8} columns={5} />
      ) : q.error && q.items.length === 0 ? (
        <ErrorState message={q.error} onRetry={() => q.reload()} />
      ) : q.items.length === 0 ? (
        <EmptyState icon={FileTextIcon} title="No events" description={action ? "Nothing recorded for this event type yet." : undefined} />
      ) : (
        <div className={cn("transition-opacity", q.fetching && "opacity-60")}>
          <div className="hidden overflow-hidden rounded-lg border lg:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-[11px]" title={dateTime(log.created_at)}>
                      {timeAgo(log.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("font-mono text-[10px]", tone(log.action))}>
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{actor(log)}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{target(log)}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{log.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ol className="space-y-2 lg:hidden">
            {q.items.map((log) => (
              <li key={log.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={cn("truncate font-mono text-[10px]", tone(log.action))}>
                    {log.action}
                  </Badge>
                  <span className="shrink-0 text-[11px] text-muted-foreground" title={dateTime(log.created_at)}>
                    {timeAgo(log.created_at)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>{actor(log)}</span>
                  {log.target_type && <span>→ {target(log)}</span>}
                  {log.ip && <span>{log.ip}</span>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <Pagination
        page={q.page}
        pageCount={q.pageCount}
        pageSize={q.pageSize}
        total={q.total}
        onPageChange={q.setPage}
        onPageSizeChange={q.setPageSize}
        pageSizeOptions={[20, 50, 100]}
        disabled={q.fetching}
        itemLabel="events"
      />
    </section>
  )
}
