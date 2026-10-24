"use client"

import { useCallback, useEffect, useState } from "react"
import { api, errorMessage, type Scenario } from "@/lib/api"
import { useToast } from "@/components/common/toaster"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { scenarioMeta } from "./scenarios"

let scenarioCache: Scenario[] | null = null

export function useSimulator() {
  const { stream, setStream, refreshNow, can } = useDashboard()
  const toast = useToast()
  const allowed = can("simulator:control")
  const [scenarios, setScenarios] = useState<Scenario[] | null>(scenarioCache)
  const [scenariosError, setScenariosError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  const loadScenarios = useCallback(
    () =>
      api.listScenarios().then(
        (list) => {
          scenarioCache = list
          setScenarios(list)
          setScenariosError(null)
        },
        (err: unknown) => setScenariosError(errorMessage(err))
      ),
    []
  )

  useEffect(() => {
    if (allowed && !scenarioCache) void loadScenarios()
  }, [allowed, loadScenarios])

  const runScenario = useCallback(
    async (name: string) => {
      setRunning(name)
      try {
        await api.runScenario(name)
        toast.success(`${scenarioMeta(name).title} sent`, "Incidents update live as the engine evaluates the batch.")
        refreshNow()
      } catch (err) {
        toast.error("Scenario failed", errorMessage(err))
      } finally {
        setRunning(null)
      }
    },
    [toast, refreshNow]
  )

  const streaming = Boolean(stream?.streaming)
  const toggleStream = useCallback(async () => {
    setToggling(true)
    try {
      if (streaming) {
        setStream(await api.stopStream())
        toast.info("Telemetry stream stopped")
      } else {
        setStream(await api.startStream(2000, 10))
        toast.success("Telemetry stream started", "10 samples every 2 seconds. It stops on its own after the configured limit.")
      }
      refreshNow()
    } catch (err) {
      toast.error("Stream control failed", errorMessage(err))
    } finally {
      setToggling(false)
    }
  }, [streaming, setStream, toast, refreshNow])

  return { allowed, scenarios, scenariosError, loadScenarios, running, runScenario, stream, toggling, toggleStream }
}
