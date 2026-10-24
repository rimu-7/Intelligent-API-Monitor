const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
]

/** "3 minutes ago", "just now". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—"
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  if (Math.abs(seconds) < 10) return "just now"
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return rtf ? rtf.format(Math.round(seconds / size), unit) : new Date(iso).toLocaleString()
    }
  }
  return "—"
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s` : `${value} ms`
}

export function percent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return "—"
  return `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.01 ? 2 : 1)}%`
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(n)
}

/** "HIGH_LATENCY" → "High latency". */
export function humanize(code: string): string {
  const s = code.toLowerCase().replaceAll("_", " ").replaceAll("-", " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}
