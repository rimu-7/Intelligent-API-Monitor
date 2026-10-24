import type { LucideIcon } from "lucide-react"
import {
  ActivityIcon,
  ClockAlertIcon,
  DatabaseZapIcon,
  FileJsonIcon,
  FlameIcon,
  GaugeIcon,
  HeartPulseIcon,
  KeyRoundIcon,
  ServerCrashIcon,
  ShuffleIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
} from "lucide-react"

export interface ScenarioMeta {
  title: string
  icon: LucideIcon
  tone: string
}

const META: Record<string, ScenarioMeta> = {
  "pdf-example": { title: "Assignment example", icon: FileJsonIcon, tone: "text-indigo-500" },
  "healthy-batch": { title: "Healthy batch", icon: HeartPulseIcon, tone: "text-emerald-500" },
  "high-latency": { title: "High latency", icon: GaugeIcon, tone: "text-amber-500" },
  "server-error": { title: "Server error", icon: ServerCrashIcon, tone: "text-red-500" },
  "zero-records": { title: "Zero records", icon: DatabaseZapIcon, tone: "text-amber-500" },
  "missing-records": { title: "Missing records", icon: TriangleAlertIcon, tone: "text-amber-500" },
  "invalid-metrics": { title: "Invalid metrics", icon: TriangleAlertIcon, tone: "text-muted-foreground" },
  "auth-failure": { title: "Auth failure", icon: KeyRoundIcon, tone: "text-red-500" },
  "rate-limited": { title: "Rate limited", icon: ClockAlertIcon, tone: "text-amber-500" },
  "outage-burst": { title: "Outage burst", icon: FlameIcon, tone: "text-red-500" },
  escalation: { title: "Escalation", icon: TrendingUpIcon, tone: "text-orange-500" },
  "mixed-batch": { title: "Mixed batch", icon: ShuffleIcon, tone: "text-sky-500" },
}

export function scenarioMeta(name: string): ScenarioMeta {
  return (
    META[name] ?? {
      title: name.replaceAll("-", " ").replace(/^\w/, (c) => c.toUpperCase()),
      icon: ActivityIcon,
      tone: "text-muted-foreground",
    }
  )
}

/** Shown first on the alerts page toolbar. */
export const QUICK_SCENARIOS = ["outage-burst", "escalation", "server-error", "high-latency", "zero-records", "mixed-batch"]
