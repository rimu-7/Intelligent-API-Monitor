"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type ToastKind = "success" | "error" | "info"

interface Toast {
  id: number
  kind: ToastKind
  title: string
  description?: string
}

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const ICONS = { success: CheckCircle2Icon, error: AlertCircleIcon, info: InfoIcon }
const TONES = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  info: "text-sky-600 dark:text-sky-400",
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = nextId.current++
      setToasts((list) => [...list.slice(-3), { id, kind, title, description }])
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4000)
    },
    [dismiss]
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push("success", t, d),
      error: (t, d) => push("error", t, d),
      info: (t, d) => push("info", t, d),
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.kind]
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2"
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[t.kind])} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{t.title}</div>
                {t.description && (
                  <div className="mt-0.5 break-words text-[11px] text-muted-foreground">{t.description}</div>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}
