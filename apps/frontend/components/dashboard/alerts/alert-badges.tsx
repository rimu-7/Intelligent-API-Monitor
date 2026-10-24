import { Badge } from "@/components/ui/badge"
import type { ApiAlert, Severity } from "@/lib/api"
import { humanize } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 text-[10px] font-medium",
        severity === "CRITICAL"
          ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", severity === "CRITICAL" ? "bg-red-500" : "bg-amber-500")} />
      {severity === "CRITICAL" ? "Critical" : "Warning"}
    </Badge>
  )
}

export function StatusBadge({ alert }: { alert: Pick<ApiAlert, "status" | "resolution_source"> }) {
  if (alert.status === "ACTIVE") {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] font-medium">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
        </span>
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-500/30 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
      Resolved{alert.resolution_source === "AUTO" ? " · auto" : ""}
    </Badge>
  )
}

export function AnomalyBadges({ types, max = 3 }: { types: string[]; max?: number }) {
  const shown = types.slice(0, max)
  const rest = types.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t} variant="secondary" className="text-[10px] font-normal">
          {humanize(t)}
        </Badge>
      ))}
      {rest > 0 && (
        <Badge variant="secondary" className="text-[10px] font-normal" title={types.slice(max).map(humanize).join(", ")}>
          +{rest}
        </Badge>
      )}
    </div>
  )
}

export function providerLabel(alert: Pick<ApiAlert, "ai_provider" | "ai_model" | "ai_status">): string {
  if (alert.ai_status === "PENDING") return "AI analysis pending"
  if (alert.ai_status === "SKIPPED") return "Rule-based · AI not requested"
  if (alert.ai_provider === "template") return "Rule-based summary"
  if (!alert.ai_provider) return "Rule-based summary"
  const name = alert.ai_provider.charAt(0).toUpperCase() + alert.ai_provider.slice(1)
  return alert.ai_model ? `${name} · ${alert.ai_model}` : name
}
