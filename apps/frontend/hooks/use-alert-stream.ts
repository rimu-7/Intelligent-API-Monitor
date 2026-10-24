"use client"

import { useEffect, useRef } from "react"
import { api } from "@/lib/api"

// SSE goes straight to the API origin: dev-server rewrites can buffer streams.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

const EVENTS = [
  "alert.created",
  "alert.updated",
  "alert.resolved",
  "alerts.invalidated",
  "monitor.run.completed",
] as const

export type AlertStreamEvent = (typeof EVENTS)[number] | "ready"

/**
 * Subscribes to live alert events. Tickets are single-use, so on any error the
 * stream is closed and reopened with a fresh ticket (backoff 1 s → 30 s).
 */
export function useAlertStream(
  enabled: boolean,
  onEvent: (name: AlertStreamEvent, data: unknown) => void,
  onConnectionChange?: (connected: boolean) => void
) {
  const onEventRef = useRef(onEvent)
  const onConnRef = useRef(onConnectionChange)
  useEffect(() => {
    onEventRef.current = onEvent
    onConnRef.current = onConnectionChange
  })

  useEffect(() => {
    if (!enabled) return
    let source: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = 1_000
    let stopped = false

    const reconnect = () => {
      source?.close()
      source = null
      onConnRef.current?.(false)
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, 30_000)
    }

    const connect = async () => {
      try {
        const { ticket } = await api.getStreamTicket()
        if (stopped) return
        source = new EventSource(
          `${API_URL}/api/v1/alerts/stream?ticket=${encodeURIComponent(ticket)}`
        )
        source.addEventListener("ready", () => {
          delay = 1_000
          onConnRef.current?.(true)
          onEventRef.current("ready", null)
        })
        for (const name of EVENTS) {
          source.addEventListener(name, (e) => {
            let payload: unknown = null
            try {
              payload = JSON.parse((e as MessageEvent).data)
            } catch {
              /* ignore malformed frame */
            }
            onEventRef.current(name, payload)
          })
        }
        source.addEventListener("shutdown", reconnect)
        source.onerror = reconnect
      } catch {
        reconnect()
      }
    }

    void connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      source?.close()
    }
  }, [enabled])
}
