"use client"

import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"

interface PaginationProps {
  page: number
  pageCount: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  disabled?: boolean
  itemLabel?: string
  className?: string
}

/** Page numbers with ellipses: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const pages = new Set([1, count, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p))
  if (page >= count - 2) [count - 3, count - 2, count - 1].forEach((p) => pages.add(p))
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b)
  const out: Array<number | "gap"> = []
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1]
    if (prev !== undefined && p - prev > 1) out.push("gap")
    out.push(p)
  })
  return out
}

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  disabled,
  itemLabel = "results",
  className,
}: PaginationProps) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const go = (p: number) => {
    if (!disabled && p !== page && p >= 1 && p <= pageCount) onPageChange(p)
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-col-reverse items-center justify-between gap-3 pt-4 sm:flex-row", className)}
    >
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {from.toLocaleString()}–{to.toLocaleString()}
          </span>{" "}
          of <span className="font-medium text-foreground tabular-nums">{total.toLocaleString()}</span> {itemLabel}
        </span>
        {onPageSizeChange && (
          <label className="hidden items-center gap-1.5 sm:flex">
            <span>Rows</span>
            <NativeSelect
              size="sm"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={disabled}
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((n) => (
                <NativeSelectOption key={n} value={String(n)}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="First page"
            className="hidden sm:inline-flex"
            onClick={() => go(1)}
            disabled={disabled || page === 1}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            onClick={() => go(page - 1)}
            disabled={disabled || page === 1}
          >
            <ChevronLeftIcon />
          </Button>

          <div className="hidden items-center gap-1 md:flex">
            {pageWindow(page, pageCount).map((p, i) =>
              p === "gap" ? (
                <span key={`gap-${i}`} className="w-6 text-center text-xs text-muted-foreground" aria-hidden>
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="icon"
                  className="tabular-nums"
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => go(p)}
                  disabled={disabled}
                >
                  {p}
                </Button>
              )
            )}
          </div>
          <span className="px-2 text-xs tabular-nums text-muted-foreground md:hidden">
            Page <span className="font-medium text-foreground">{page}</span> / {pageCount}
          </span>

          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            onClick={() => go(page + 1)}
            disabled={disabled || page === pageCount}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Last page"
            className="hidden sm:inline-flex"
            onClick={() => go(pageCount)}
            disabled={disabled || page === pageCount}
          >
            <ChevronsRightIcon />
          </Button>
        </div>
      )}
    </nav>
  )
}
