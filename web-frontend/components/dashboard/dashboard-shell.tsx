"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  ActivityIcon,
  BellRingIcon,
  ChevronDownIcon,
  FileTextIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  ServerIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth-context"
import { cn } from "@/lib/utils"
import { useDashboard, type Section } from "./dashboard-context"

interface NavItem {
  id: Section
  label: string
  title: string
  icon: LucideIcon
  permission?: string
}

const NAV: NavItem[] = [
  { id: "alerts", label: "Incidents", title: "Incidents", icon: BellRingIcon, permission: "alerts:read" },
  { id: "services", label: "Services", title: "Monitored services", icon: ServerIcon, permission: "apis:read" },
  { id: "simulator", label: "Simulator", title: "Telemetry simulator", icon: ZapIcon, permission: "simulator:control" },
  { id: "users", label: "Team", title: "Team & access", icon: UsersIcon, permission: "users:manage" },
  { id: "audit", label: "Audit log", title: "Audit log", icon: FileTextIcon, permission: "audit:read" },
  { id: "settings", label: "Settings", title: "Settings", icon: SettingsIcon },
]

export function useVisibleNav() {
  const { can } = useDashboard()
  return NAV.filter((n) => !n.permission || can(n.permission))
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { section } = useDashboard()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const current = NAV.find((n) => n.id === section)

  // Close the drawer with Escape, and lock page scroll while it is open.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false)
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <Brand />
        <Nav />
        <SidebarFooter />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50 animate-in fade-in" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar shadow-xl animate-in slide-in-from-left">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
                <XIcon />
              </Button>
            </div>
            <Nav onNavigate={() => setDrawerOpen(false)} />
            <SidebarFooter />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </Button>
          <h1 className="truncate text-sm font-semibold tracking-tight">{current?.title ?? "Dashboard"}</h1>
          <div className="ml-auto flex items-center gap-2">
            <LiveIndicator />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2.5 px-5">
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ActivityIcon className="size-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">API Monitor</div>
        <div className="text-[10px] text-muted-foreground">Anomaly detection</div>
      </div>
    </div>
  )
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { section, setSection, summary } = useDashboard()
  const items = useVisibleNav()
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Main">
      {items.map((item) => {
        const active = section === item.id
        const Icon = item.icon
        const badge = item.id === "alerts" ? summary?.active.total : undefined
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              setSection(item.id)
              onNavigate?.()
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {badge !== undefined && badge > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                  (summary?.active.critical ?? 0) > 0 ? "bg-red-500 text-white" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                )}
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

function SidebarFooter() {
  const { liveConnected, stream } = useDashboard()
  return (
    <div className="space-y-1 border-t px-5 py-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", liveConnected ? "bg-emerald-500" : "bg-amber-500")} />
        {liveConnected ? "Live updates on" : "Reconnecting…"}
      </div>
      {stream?.streaming && (
        <div className="flex items-center gap-2">
          <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />
          Simulator streaming
        </div>
      )}
    </div>
  )
}

function LiveIndicator() {
  const { liveConnected } = useDashboard()
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground sm:inline-flex"
      title={liveConnected ? "Receiving live updates" : "Live connection lost; polling every 5 s"}
    >
      <span className="relative flex size-1.5">
        {liveConnected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", liveConnected ? "bg-emerald-500" : "bg-amber-500")} />
      </span>
      {liveConnected ? "Live" : "Polling"}
    </span>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const { setSection } = useDashboard()
  const { resolvedTheme, setTheme } = useTheme()
  if (!user) return null
  const dark = resolvedTheme === "dark"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-9 gap-2 rounded-full pr-2 pl-1" aria-label="Account menu">
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                {user.email.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 truncate text-xs md:inline">{user.email}</span>
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="truncate text-xs font-medium">{user.email}</div>
            <div className="text-[10px] text-muted-foreground">{user.role === "ADMIN" ? "Admin" : "Manager"}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setSection("settings")}>
          <SettingsIcon /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme(dark ? "light" : "dark")}>
          {dark ? <SunIcon /> : <MoonIcon />} {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
