"use client"

import { useCallback, useMemo, useState } from "react"
import { MoreHorizontalIcon, PlusIcon, RotateCwIcon, UsersIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pagination } from "@/components/common/pagination"
import { SectionHeader } from "@/components/common/section-header"
import { EmptyState, ErrorState, ResponsiveListSkeleton } from "@/components/common/states"
import { useToast } from "@/components/common/toaster"
import { useAuth } from "@/components/auth-context"
import { usePaginatedQuery } from "@/hooks/use-paginated-query"
import { api, errorMessage, type ApiUser, type Role } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CreateUserDialog } from "./create-user-dialog"

export function UsersView() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [role, setRole] = useState<Role | "">("")
  const [active, setActive] = useState<"" | "true" | "false">("")
  const [createOpen, setCreateOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const filters = useMemo(
    () => ({ role: role || undefined, is_active: active === "" ? undefined : active === "true" }),
    [role, active]
  )
  const fetcher = useCallback((p: { limit: number; offset: number }) => api.listUsers({ ...filters, ...p }), [filters])
  const q = usePaginatedQuery(fetcher, { resetKey: JSON.stringify(filters) })

  const update = async (u: ApiUser, payload: { role?: Role; is_active?: boolean }, done: string) => {
    setBusyId(u.id)
    try {
      await api.updateUser(u.id, payload)
      toast.success(done)
      await q.reload({ silent: true })
    } catch (err) {
      toast.error("Update failed", errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const actions = (u: ApiUser) =>
    u.id === me?.id ? (
      <span className="text-[11px] text-muted-foreground">You</span>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`} disabled={busyId === u.id}>
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() =>
              update(u, { role: u.role === "ADMIN" ? "MANAGER" : "ADMIN" }, `${u.email} is now ${u.role === "ADMIN" ? "a manager" : "an admin"}`)
            }
          >
            Make {u.role === "ADMIN" ? "manager" : "admin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant={u.is_active ? "destructive" : "default"}
            onClick={() =>
              update(u, { is_active: !u.is_active }, `${u.email} ${u.is_active ? "deactivated" : "reactivated"}`)
            }
          >
            {u.is_active ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Team & access"
        description="Admins have every permission. Managers can sign in but have no access yet (deny by default)."
        actions={
          <>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => q.reload()} disabled={q.fetching}>
              <RotateCwIcon className={cn(q.fetching && "animate-spin")} />
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> Add user
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role | "")} aria-label="Role" className="w-full sm:w-36">
          <NativeSelectOption value="">All roles</NativeSelectOption>
          <NativeSelectOption value="ADMIN">Admin</NativeSelectOption>
          <NativeSelectOption value="MANAGER">Manager</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={active}
          onChange={(e) => setActive(e.target.value as "" | "true" | "false")}
          aria-label="Status"
          className="w-full sm:w-36"
        >
          <NativeSelectOption value="">Any status</NativeSelectOption>
          <NativeSelectOption value="true">Active</NativeSelectOption>
          <NativeSelectOption value="false">Deactivated</NativeSelectOption>
        </NativeSelect>
      </div>

      {q.loading ? (
        <ResponsiveListSkeleton rows={5} columns={5} />
      ) : q.error && q.items.length === 0 ? (
        <ErrorState message={q.error} onRetry={() => q.reload()} />
      ) : q.items.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users match these filters" />
      ) : (
        <div className={cn("transition-opacity", q.fetching && "opacity-60")}>
          <div className="hidden overflow-hidden rounded-lg border lg:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-0 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <UserCell user={u} />
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={u.role} />
                    </TableCell>
                    <TableCell>
                      <ActiveBadge active={u.is_active} />
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {u.last_login_at ? timeAgo(u.last_login_at) : "Never"}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{timeAgo(u.created_at)}</TableCell>
                    <TableCell className="text-right">{actions(u)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {q.items.map((u) => (
              <li key={u.id} className="flex items-center gap-3 rounded-xl border bg-card p-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <UserCell user={u} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RoleBadge role={u.role} />
                    <ActiveBadge active={u.is_active} />
                    <span className="text-[11px] text-muted-foreground">
                      · {u.last_login_at ? `signed in ${timeAgo(u.last_login_at)}` : "never signed in"}
                    </span>
                  </div>
                </div>
                {actions(u)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pagination
        page={q.page}
        pageCount={q.pageCount}
        pageSize={q.pageSize}
        total={q.total}
        onPageChange={q.setPage}
        onPageSizeChange={q.setPageSize}
        disabled={q.fetching}
        itemLabel="users"
      />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void q.reload({ silent: true })
        }}
      />
    </section>
  )
}

function UserCell({ user }: { user: ApiUser }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-7">
        <AvatarFallback className="text-[10px] font-medium">{user.email.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate text-xs font-medium">{user.email}</span>
    </div>
  )
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={role === "ADMIN" ? "default" : "secondary"} className="text-[10px]">
      {role === "ADMIN" ? "Admin" : "Manager"}
    </Badge>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-emerald-500/30 text-[10px] text-emerald-700 dark:text-emerald-400">
      Active
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      Deactivated
    </Badge>
  )
}
