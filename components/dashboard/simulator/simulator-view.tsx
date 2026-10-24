"use client"

import { PlayIcon, RotateCwIcon, SquareIcon, ZapIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { SectionHeader } from "@/components/common/section-header"
import { ErrorState } from "@/components/common/states"
import { humanize, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { scenarioMeta } from "./scenarios"
import { useSimulator } from "./use-simulator"

export function SimulatorView() {
  const sim = useSimulator()
  const s = sim.stream
  const streaming = Boolean(s?.streaming)

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeader
          title="Continuous stream"
          description="Sends a steady flow of realistic telemetry, healthy and anomalous, so incidents open and escalate on their own."
        />
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-full",
                  streaming ? "bg-emerald-500/10" : "bg-muted"
                )}
              >
                <span
                  className={cn("size-2.5 rounded-full", streaming ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40")}
                />
              </div>
              <div>
                <div className="text-sm font-medium">{streaming ? "Streaming" : "Stopped"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {streaming
                    ? `${s?.batch_size ?? 10} samples every ${((s?.interval_ms ?? 2000) / 1000).toFixed(1)} s · stops ${timeAgo(s?.stops_at)}`
                    : s?.stopped_reason
                      ? `Last run ended: ${humanize(s.stopped_reason)}`
                      : "Not started yet"}
                </div>
              </div>
            </div>
            <Button
              variant={streaming ? "destructive" : "default"}
              size="lg"
              onClick={sim.toggleStream}
              disabled={sim.toggling || s === null}
              className="w-full sm:w-auto"
            >
              {sim.toggling ? <Spinner /> : streaming ? <SquareIcon /> : <PlayIcon />}
              {streaming ? "Stop stream" : "Start stream"}
            </Button>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-[11px] sm:grid-cols-4">
            <StreamFact label="Samples sent" value={s ? s.items_sent.toLocaleString() : null} />
            <StreamFact label="Batches sent" value={s ? s.batches_sent.toLocaleString() : null} />
            <StreamFact label="Started" value={s ? timeAgo(s.started_at) : null} />
            <StreamFact
              label="Failures in a row"
              value={s ? String(s.consecutive_failures) : null}
              className={s && s.consecutive_failures > 0 ? "text-destructive" : undefined}
            />
          </dl>
          {s?.last_error && (
            <p className="mt-3 rounded-md bg-destructive/5 px-3 py-2 text-[11px] text-destructive">Last error: {s.last_error}</p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Scenarios"
          description="One-shot batches that reproduce a specific failure. Each one goes through the same ingestion pipeline as real traffic."
        />
        {sim.scenariosError ? (
          <ErrorState message={sim.scenariosError} onRetry={sim.loadScenarios} />
        ) : !sim.scenarios ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-3 rounded-xl border p-4">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-7 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sim.scenarios.map((sc) => {
              const meta = scenarioMeta(sc.name)
              const Icon = meta.icon
              const busy = sim.running === sc.name
              return (
                <li key={sc.name} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className={cn("size-4", meta.tone)} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">{meta.title}</h3>
                        <Badge variant="outline" className="font-mono text-[9px] text-muted-foreground">
                          {sc.name}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{sc.description}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-auto self-start"
                    onClick={() => sim.runScenario(sc.name)}
                    disabled={sim.running !== null}
                  >
                    {busy ? <Spinner /> : <ZapIcon />}
                    {busy ? "Sending…" : "Run scenario"}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {sim.scenarios && (
          <Button variant="ghost" size="sm" onClick={sim.loadScenarios}>
            <RotateCwIcon /> Reload scenarios
          </Button>
        )}
      </section>
    </div>
  )
}

function StreamFact({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-medium tabular-nums", className)}>
        {value === null ? <Skeleton className="mt-1 h-4 w-12" /> : value}
      </dd>
    </div>
  )
}
