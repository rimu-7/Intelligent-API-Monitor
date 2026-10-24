"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAlertStream } from "@/hooks/use-alert-stream"

/**
 * One "tick" counter for the whole dashboard. It bumps (debounced) on every live SSE event,
 * and on a timer as a safety net: every 5 s while the stream is down, every 30 s otherwise.
 * Views put `tick` in their refresh deps to refetch silently.
 */
export function useLiveRefresh(enabled: boolean) {
  const [tick, setTick] = useState(0)
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const bump = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setTick((t) => t + 1), 350)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  useAlertStream(enabled, bump, setConnected)

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(bump, connected ? 30_000 : 5_000)
    return () => clearInterval(id)
  }, [enabled, connected, bump])

  // Refetch as soon as the tab becomes visible again.
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => {
      if (document.visibilityState === "visible") bump()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [enabled, bump])

  return { tick, connected, refreshNow: bump }
}
