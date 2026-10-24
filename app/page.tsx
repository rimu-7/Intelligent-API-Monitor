"use client"

import { useEffect } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/components/auth-context"
import { DashboardProvider, useDashboard, type Section } from "@/components/dashboard/dashboard-context"
import { DashboardShell, useVisibleNav } from "@/components/dashboard/dashboard-shell"
import { AlertsView } from "@/components/dashboard/alerts/alerts-view"
import { AuditView } from "@/components/dashboard/audit/audit-view"
import { ServicesView } from "@/components/dashboard/services/services-view"
import { SettingsView } from "@/components/dashboard/settings/settings-view"
import { SimulatorView } from "@/components/dashboard/simulator/simulator-view"
import { UsersView } from "@/components/dashboard/users/users-view"

const VIEWS: Record<Section, React.ComponentType> = {
  alerts: AlertsView,
  services: ServicesView,
  simulator: SimulatorView,
  users: UsersView,
  audit: AuditView,
  settings: SettingsView,
}

export default function DashboardPage() {
  const { user, loading } = useAuth()

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <DashboardProvider>
      <DashboardShell>
        <CurrentSection />
      </DashboardShell>
    </DashboardProvider>
  )
}

function CurrentSection() {
  const { section, setSection } = useDashboard()
  const visible = useVisibleNav()
  const allowed = visible.some((n) => n.id === section)

  // A hash pointing at a section this user can't open falls back to the first one they can.
  useEffect(() => {
    if (!allowed && visible[0]) setSection(visible[0].id)
  }, [allowed, visible, setSection])

  if (!allowed) return null
  const View = VIEWS[section]
  return <View key={section} />
}
