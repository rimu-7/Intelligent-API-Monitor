import { Skeleton } from "@/components/ui/skeleton"
import { ResponsiveListSkeleton, StatCardSkeleton } from "@/components/common/states"

/** The dashboard's shape while the session is checked: no blank screen, no layout jump. */
export function DashboardSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background" aria-busy="true" aria-label="Loading dashboard">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <Skeleton className="size-7 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2 w-16" />
          </div>
        </div>
        <div className="space-y-2 px-3 py-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4 sm:px-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-auto size-8 rounded-full" />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <Skeleton className="h-16 w-full rounded-xl" />
          <ResponsiveListSkeleton rows={6} columns={6} />
        </main>
      </div>
    </div>
  )
}
