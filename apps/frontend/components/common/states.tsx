import type { LucideIcon } from "lucide-react"
import { AlertCircleIcon, RotateCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">{title}</div>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertCircleIcon className="mb-2 size-5 text-destructive" />
      <div className="text-sm font-medium">Couldn&apos;t load this data</div>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCwIcon /> Try again
        </Button>
      )}
    </div>
  )
}

/** Mirrors a table's shape while it loads. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border" aria-busy="true" aria-label="Loading">
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1 space-y-1.5">
              <Skeleton className={cn("h-3", c === 0 ? "w-3/4" : "w-1/2")} />
              {c === 0 && <Skeleton className="h-2.5 w-full opacity-60" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Mirrors the card list used on small screens. */
export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-4/5" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Table on large screens, cards below — while loading. */
export function ResponsiveListSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <>
      <div className="hidden lg:block">
        <TableSkeleton rows={rows} columns={columns} />
      </div>
      <div className="lg:hidden">
        <CardListSkeleton count={Math.min(rows, 4)} />
      </div>
    </>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-14" />
      <Skeleton className="h-2.5 w-32" />
    </div>
  )
}
