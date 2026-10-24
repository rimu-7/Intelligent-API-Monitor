"use client"

import { useState } from "react"
import { ActivityIcon, AlertCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/components/auth-context"
import { errorMessage } from "@/lib/api"

// Local seed accounts (see .env / seed). Shown only in development builds.
const DEMO_ACCOUNTS =
  process.env.NODE_ENV === "production"
    ? []
    : [
        { label: "Admin", email: "admin@example.com", password: "Admin@123456!" },
        { label: "Manager", email: "manager@example.com", password: "Manager@123456!" },
      ]

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(errorMessage(err, "Sign-in failed. Check your email and password."))
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ActivityIcon className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in to API Monitor</h1>
            <p className="mt-1 text-xs text-muted-foreground">Real-time anomaly detection for your APIs</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="you@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Spinner />}
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {DEMO_ACCOUNTS.length > 0 && (
          <div className="space-y-2">
            <div className="text-center text-[11px] text-muted-foreground">Local demo accounts</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setEmail(a.email)
                    setPassword(a.password)
                    setError(null)
                  }}
                  className="rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <div className="text-xs font-medium">{a.label}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{a.email}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
