"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { errorMessage, type Page, type PageParams } from "@/lib/api"

export interface PaginatedQuery<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  /** True only until the first page arrives (show skeletons). */
  loading: boolean
  /** True while another page/filter, or a manual refresh, is loading (keep old rows, dim them). */
  fetching: boolean
  error: string | null
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  /** Refetch the current page; `silent` skips the busy state. */
  reload: (opts?: { silent?: boolean }) => Promise<void>
}

interface Options {
  initialPageSize?: number
  /** Changing this key (e.g. serialized filters) jumps back to page 1. */
  resetKey?: string
  /** Bumping this number triggers a silent background refetch (live updates). */
  refreshTick?: number
}

interface Result<T> {
  key: string
  items: T[]
  total: number
  error: string | null
}

/**
 * Server-side pagination over any `{ items, meta: { total, limit, offset } }` endpoint.
 * Responses for an outdated page/filter are dropped, so fast clicks never show the wrong page.
 */
export function usePaginatedQuery<T>(
  fetcher: (params: PageParams) => Promise<Page<T>>,
  { initialPageSize = 10, resetKey = "", refreshTick = 0 }: Options = {}
): PaginatedQuery<T> {
  const [pageState, setPageState] = useState({ page: 1, resetKey })
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  const [result, setResult] = useState<Result<T> | null>(null)
  const [manual, setManual] = useState(false)

  // Filters changed → back to page 1 (derived during render, no extra effect pass).
  const page = pageState.resetKey === resetKey ? pageState.page : 1
  if (pageState.resetKey !== resetKey) setPageState({ page: 1, resetKey })

  const key = `${resetKey}|${page}|${pageSize}`
  const fetcherRef = useRef(fetcher)
  const keyRef = useRef(key)
  useEffect(() => {
    fetcherRef.current = fetcher
    keyRef.current = key
  })

  const run = useCallback(
    (forKey: string, targetPage: number, size: number, keepOnError: boolean): Promise<void> =>
      fetcherRef.current({ limit: size, offset: (targetPage - 1) * size }).then(
        (res) => {
          if (forKey !== keyRef.current) return
          const lastPage = Math.max(1, Math.ceil(res.meta.total / size))
          // The current page can disappear (e.g. resolving the only row on the last page): step back.
          if (targetPage > lastPage && res.meta.total > 0) {
            setPageState((s) => ({ ...s, page: lastPage }))
            return
          }
          setResult({ key: forKey, items: res.items, total: res.meta.total, error: null })
        },
        (err: unknown) => {
          if (forKey !== keyRef.current) return
          // Background refreshes keep the last good rows instead of flashing an error.
          setResult((prev) =>
            keepOnError && prev ? { ...prev, key: forKey } : { key: forKey, items: prev?.items ?? [], total: prev?.total ?? 0, error: errorMessage(err) }
          )
        }
      ),
    []
  )

  useEffect(() => {
    void run(key, page, pageSize, false)
  }, [run, key, page, pageSize])

  useEffect(() => {
    if (refreshTick === 0) return
    void run(keyRef.current, page, pageSize, true)
    // Only a new tick should trigger this; page/size changes are handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, run])

  const setPage = useCallback((next: number) => setPageState((s) => ({ ...s, page: Math.max(1, Math.floor(next)) })), [])
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    setPageState((s) => ({ ...s, page: 1 }))
  }, [])
  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setManual(true)
      try {
        await run(key, page, pageSize, Boolean(opts?.silent))
      } finally {
        setManual(false)
      }
    },
    [run, key, page, pageSize]
  )

  const total = result?.total ?? 0
  return {
    items: result?.items ?? [],
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    loading: result === null,
    fetching: manual || (result !== null && result.key !== key),
    error: result?.error ?? null,
    setPage,
    setPageSize,
    reload,
  }
}
