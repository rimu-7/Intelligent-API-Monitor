"use client"

import { useState } from "react"
import { PlayIcon, SquareIcon, ZapIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { compact } from "@/lib/format"
import { QUICK_SCENARIOS, scenarioMeta } from "./scenarios"
import { useSimulator } from "./use-simulator"

/** Compact telemetry controls for the alerts page. */
export function SimulatorToolbar() {
  const sim = useSimulator()
  const [choice, setChoice] = useState(QUICK_SCENARIOS[0] ?? "outage-burst")
  if (!sim.allowed) return null

  const names = sim.scenarios?.map((s) => s.name) ?? QUICK_SCENARIOS
  const ordered = [...QUICK_SCENARIOS.filter((n) => names.includes(n)), ...names.filter((n) => !QUICK_SCENARIOS.includes(n))]
  const streaming = Boolean(sim.stream?.streaming)

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
          <ZapIcon className="size-4 text-amber-500" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium">Telemetry simulation</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {streaming ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                Streaming · {compact(sim.stream?.items_sent ?? 0)} samples sent
              </span>
            ) : (
              "Send a scenario or start a continuous stream"
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          <NativeSelect
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Scenario"
            className="min-w-0 flex-1 sm:w-44"
          >
            {ordered.map((n) => (
              <NativeSelectOption key={n} value={n}>
                {scenarioMeta(n).title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button variant="outline" onClick={() => sim.runScenario(choice)} disabled={sim.running !== null}>
            {sim.running ? <Spinner /> : <ZapIcon />}
            Run
          </Button>
        </div>
        <Button
          variant={streaming ? "destructive" : "default"}
          onClick={sim.toggleStream}
          disabled={sim.toggling}
          className="w-full sm:w-auto"
        >
          {sim.toggling ? <Spinner /> : streaming ? <SquareIcon /> : <PlayIcon />}
          {streaming ? "Stop stream" : "Start stream"}
        </Button>
      </div>
    </div>
  )
}
