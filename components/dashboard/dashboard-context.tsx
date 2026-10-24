"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { api, type AlertSummary, type MonitoredApi, type StreamStatus } from "@/lib/api"
import { useLiveRefresh } from "@/hooks/use-live-refresh"
import { useAuth } from "@/components/auth-context"

export type Section = "alerts" | "services" | "simulator" | "users" | "audit" | "settings"

interface DashboardState {
  section: Section
  setSection: (s: Section) => void
  /** Bumps on live events and on a timer; put it in refetch deps. */
  tick: number
  liveConnected: boolean
  refreshNow: () => void
  summary: AlertSummary | null
  apis: MonitoredApi[] | null
  stream: StreamStatus | null
  setStream: (s: StreamStatus) => void
  can: (permission: string) => boolean
}

const DashboardContext = createContext<DashboardState | null>(null)

const SECTIONS: Section[] = ["alerts", "services", "simulator", "users", "audit", "settings"]

const sectionFromHash = (): Section => {
  if (typeof window === "undefined") return "alerts"
  const hash = window.location.hash.replace("#", "") as Section
  return SECTIONS.includes(hash) ? hash : "alerts"
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const { user, permissions } = useAuth()
  const enabled = Boolean(user)
  const { tick, connected, refreshNow } = useLiveRefresh(enabled)

  const [section, setSectionState] = useState<Section>("alerts")
  const [summary, setSummary] = useState<AlertSummary | null>(null)
  const [apis, setApis] = useState<MonitoredApi[] | null>(null)
  const [stream, setStream] = useState<StreamStatus | null>(null)

  const can = useCallback((p: string) => permissions.includes(p), [permissions])

  // The section lives in the URL hash so refresh and back/forward keep your place.
  useEffect(() => {
    const sync = () => setSectionState(sectionFromHash())
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])
  const setSection = useCallback((s: Section) => {
    if (window.location.hash !== `#${s}`) window.location.hash = s
    setSectionState(s)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      const [sum, list, st] = await Promise.allSettled([
        can("alerts:read") ? api.getAlertSummary() : Promise.resolve(null),
        can("apis:read") ? api.listApis() : Promise.resolve(null),
        can("simulator:control") ? api.getStreamStatus() : Promise.resolve(null),
      ])
      if (cancelled) return
      if (sum.status === "fulfilled" && sum.value) setSummary(sum.value)
      if (list.status === "fulfilled" && list.value) setApis(list.value)
      if (st.status === "fulfilled" && st.value) setStream(st.value)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [enabled, tick, can])

  const value = useMemo<DashboardState>(
    () => ({
      section,
      setSection,
      tick,
      liveConnected: connected,
      refreshNow,
      summary,
      apis,
      stream,
      setStream,
      can,
    }),
    [section, setSection, tick, connected, refreshNow, summary, apis, stream, can]
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}
