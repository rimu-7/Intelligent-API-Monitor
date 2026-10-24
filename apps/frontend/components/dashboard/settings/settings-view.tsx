"use client"

import { useState } from "react"
import { KeyRoundIcon, UserIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { SectionHeader } from "@/components/common/section-header"
import { useToast } from "@/components/common/toaster"
import { useAuth } from "@/components/auth-context"
import { useDashboard } from "@/components/dashboard/dashboard-context"
import { api, errorMessage } from "@/lib/api"
import { EmailSettingsCard } from "./email-settings-card"

export function SettingsView() {
  const { can } = useDashboard()
  return (
    <div className="space-y-8">
      {can("settings:manage") && (
        <section className="space-y-4">
          <SectionHeader title="Notifications" description="Where incident emails go, and a way to check they arrive." />
          <EmailSettingsCard />
        </section>
      )}
      <section className="space-y-4">
        <SectionHeader title="Your account" />
        <div className="grid gap-4 lg:grid-cols-2">
          <AccountCard />
          <PasswordCard />
        </div>
      </section>
    </div>
  )
}

function AccountCard() {
  const { user, permissions } = useAuth()
  if (!user) return null
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <CardTitle icon={UserIcon} title="Profile" />
      <dl className="space-y-3 text-xs">
        <div>
          <dt className="text-[11px] text-muted-foreground">Email</dt>
          <dd className="mt-0.5 break-all font-medium">{user.email}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Role</dt>
          <dd className="mt-1">
            <Badge variant={user.role === "ADMIN" ? "default" : "secondary"} className="text-[10px]">
              {user.role === "ADMIN" ? "Admin" : "Manager"}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Permissions</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1">
            {permissions.length === 0 ? (
              <span className="text-muted-foreground">None yet</span>
            ) : (
              permissions.map((p) => (
                <Badge key={p} variant="secondary" className="font-mono text-[10px] font-normal">
                  {p}
                </Badge>
              ))
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function PasswordCard() {
  const toast = useToast()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirm.length > 0 && confirm !== next

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setError("The new passwords don't match")
    setSaving(true)
    setError(null)
    try {
      await api.changePassword({ current_password: current, new_password: next })
      setCurrent("")
      setNext("")
      setConfirm("")
      toast.success("Password changed", "You were signed out everywhere else.")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <CardTitle icon={KeyRoundIcon} title="Change password" hint="12–128 characters. Other sessions end." />
      <div className="space-y-3">
        <Field id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field id="new-password" label="New password" value={next} onChange={setNext} autoComplete="new-password" minLength={12} />
        <Field
          id="confirm-password"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          minLength={12}
          invalid={mismatch}
        />
      </div>
      {(error || mismatch) && (
        <p className="text-[11px] text-destructive">{error ?? "The new passwords don't match"}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !current || next.length < 12 || mismatch}>
          {saving && <Spinner />}
          Update password
        </Button>
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  minLength?: number
  invalid?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        required
        maxLength={128}
        minLength={minLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
      />
    </div>
  )
}

function CardTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
