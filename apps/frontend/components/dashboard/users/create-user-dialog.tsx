"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/common/toaster"
import { api, errorMessage, type Role } from "@/lib/api"

const EMPTY = { email: "", password: "", role: "MANAGER" as Role }

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = (next: boolean) => {
    if (!next) {
      setForm(EMPTY)
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.createUser(form)
      toast.success(`${form.email} added`)
      onCreated()
      close(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add user</DialogTitle>
          <DialogDescription className="text-xs">They sign in with this email and password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-email" className="text-xs">
              Email
            </Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="off"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs">
              Password
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 12 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role" className="text-xs">
              Role
            </Label>
            <NativeSelect
              id="new-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <NativeSelectOption value="MANAGER">Manager — sign-in only for now</NativeSelectOption>
              <NativeSelectOption value="ADMIN">Admin — full access</NativeSelectOption>
            </NativeSelect>
          </div>
          {error && <p className="rounded-md bg-destructive/5 px-3 py-2 text-[11px] text-destructive">{error}</p>}
          <DialogFooter className="pt-1">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
