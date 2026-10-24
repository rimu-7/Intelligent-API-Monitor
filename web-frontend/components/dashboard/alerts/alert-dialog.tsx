"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2Icon, LightbulbIcon, SearchIcon, SparklesIcon, WrenchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/common/toaster"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { api, errorMessage, type ApiAlert } from "@/lib/api"
import { dateTime, ms, timeAgo } from "@/lib/format"
import { AnomalyBadges, providerLabel, SeverityBadge, StatusBadge } from "./alert-badges"

export type AlertDialogMode = "details" | "resolve"

interface Props {
  alert: ApiAlert | null
  mode: AlertDialogMode
  onModeChange: (mode: AlertDialogMode) => void
  onClose: () => void
}

const POLL_MS = 1000
const POLL_LIMIT = 25

export function AlertDialog({ alert: initial, mode, onModeChange, onClose }: Props) {
  const { can, refreshNow, tick } = useDashboard()
  const toast = useToast()
  // The parent keys this component by alert id, so state starts fresh for each alert.
  const [alert, setAlert] = useState<ApiAlert | null>(initial)
  const [note, setNote] = useState("")
  const [resolving, setResolving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [pollGaveUp, setPollGaveUp] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const analyzing = regenerating || (alert?.ai_status === "PENDING" && !pollGaveUp)

  // Keep the open alert fresh (live events / timer).
  useEffect(() => {
    if (!initial || tick === 0) return
    let cancelled = false
    api
      .getAlert(initial.id)
      .then((a) => {
        if (!cancelled) setAlert(a)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tick, initial])

  // While AI text is pending, poll until the worker finishes.
  useEffect(() => {
    if (!alert || alert.ai_status !== "PENDING" || pollGaveUp) return
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const fresh = await api.getAlert(alert.id)
        setAlert(fresh)
        if (fresh.ai_status !== "PENDING") return
      } catch {
        /* keep polling */
      }
      if (attempts < POLL_LIMIT) pollTimer.current = setTimeout(poll, POLL_MS)
      else setPollGaveUp(true)
    }
    pollTimer.current = setTimeout(poll, POLL_MS)
    return () => clearTimeout(pollTimer.current)
  }, [alert?.id, alert?.ai_status, pollGaveUp]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) return null

  const canResolve = alert.status === "ACTIVE" && can("alerts:resolve")
  const canRegenerate = can("alerts:regenerate")
  const skipped = alert.ai_status === "SKIPPED"

  const resolve = async () => {
    setResolving(true)
    try {
      await api.resolveAlert(alert.id, note)
      toast.success(`${alert.api_name} resolved`)
      refreshNow()
      onClose()
    } catch (err) {
      toast.error("Could not resolve", errorMessage(err))
      if ((err as { code?: string }).code === "ALERT_ALREADY_RESOLVED") {
        refreshNow()
        onClose()
      }
    } finally {
      setResolving(false)
    }
  }

  const regenerate = async () => {
    setRegenerating(true)
    try {
      const updated = await api.regenerateAi(alert.id)
      setPollGaveUp(false)
      setAlert({ ...updated, ai_status: "PENDING" })
    } catch (err) {
      toast.error("Re-analysis failed", errorMessage(err))
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="text-sm font-semibold">{alert.api_name}</DialogTitle>
            <SeverityBadge severity={alert.severity} />
            <StatusBadge alert={alert} />
          </div>
          <DialogDescription className="text-[11px]">
            First seen {timeAgo(alert.first_seen_at)} · last seen {timeAgo(alert.last_seen_at)} ·{" "}
            {alert.occurrence_count.toLocaleString()} occurrence{alert.occurrence_count === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>

        {mode === "resolve" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{alert.alert_message}</p>
            <Label htmlFor="resolution-note" className="text-xs">
              Resolution note <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="resolution-note"
              autoFocus
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Rolled back the failing deploy; latency back to normal."
              className="min-h-20"
            />
            <div className="text-right text-[10px] tabular-nums text-muted-foreground">{note.length}/500</div>
          </div>
        ) : (
          <div className="space-y-4">
            <AnomalyBadges types={alert.anomaly_types} max={6} />

            <Block icon={SearchIcon} title="What happened">
              <p>{alert.alert_message}</p>
            </Block>

            {skipped && !analyzing && (
              <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 p-3 sm:flex-row sm:items-center">
                <p className="flex-1 text-[11px] text-muted-foreground">
                  To save AI usage, this incident got rule-based suggestions instead of AI analysis: it
                  didn&apos;t trigger an email.
                </p>
                {canRegenerate && (
                  <Button size="sm" onClick={regenerate} className="self-start sm:self-auto">
                    <SparklesIcon /> Generate AI analysis
                  </Button>
                )}
              </div>
            )}

            <Block
              icon={LightbulbIcon}
              title="Probable cause"
              aside={
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <SparklesIcon className="size-3" /> {providerLabel(alert)}
                </span>
              }
            >
              {analyzing ? <TextSkeleton /> : <p>{alert.probable_cause || "No cause suggested yet."}</p>}
            </Block>

            <Block icon={WrenchIcon} title="Recommended action">
              {analyzing ? <TextSkeleton /> : <p>{alert.recommended_action || "No action suggested yet."}</p>}
            </Block>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 text-[11px] sm:grid-cols-3">
              <Fact label="Peak response" value={ms(alert.peak_response_time_ms)} />
              <Fact label="Last response" value={ms(alert.last_response_time_ms ?? alert.response_time_ms)} />
              <Fact label="Last status" value={String(alert.last_status_code ?? alert.status_code ?? "—")} />
              <Fact label="Records" value={String(alert.last_records_returned ?? alert.records_returned ?? "—")} />
              <Fact label="First seen" value={dateTime(alert.first_seen_at)} />
              <Fact label="Last seen" value={dateTime(alert.last_seen_at)} />
              {alert.resolved_at && <Fact label="Resolved" value={dateTime(alert.resolved_at)} />}
              {alert.resolution_note && (
                <div className="col-span-full">
                  <dt className="text-muted-foreground">Resolution note</dt>
                  <dd className="mt-0.5 text-foreground">{alert.resolution_note}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {mode === "resolve" ? (
            <>
              <Button variant="ghost" onClick={() => onModeChange("details")} disabled={resolving}>
                Back to details
              </Button>
              <Button onClick={resolve} disabled={resolving}>
                {resolving ? <Spinner /> : <CheckCircle2Icon />}
                Resolve incident
              </Button>
            </>
          ) : (
            <>
              {/* Skipped incidents get their single, prominent button in the callout above. */}
              {canRegenerate && (!skipped || analyzing) ? (
                <Button variant="outline" onClick={regenerate} disabled={analyzing}>
                  {analyzing ? <Spinner /> : <SparklesIcon />}
                  {analyzing ? "Analyzing…" : "Re-analyze"}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                {canResolve && (
                  <Button onClick={() => onModeChange("resolve")}>
                    <CheckCircle2Icon /> Resolve
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Block({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium">
          <Icon className="size-3.5 text-muted-foreground" />
          {title}
        </h3>
        {aside}
      </div>
      <div className="text-xs leading-relaxed text-foreground/90">{children}</div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function TextSkeleton() {
  return (
    <div className="space-y-1.5 py-0.5">
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  )
}
