"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2Icon, MailIcon, PlusIcon, SendIcon, XCircleIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ErrorState } from "@/components/common/states"
import { useToast } from "@/components/common/toaster"
import { api, errorMessage, type NotificationSettings, type TestEmailResult } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"

const MAX_RECIPIENTS = 10
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type TestOutcome = { ok: true; result: TestEmailResult } | { ok: false; message: string }

export function EmailSettingsCard() {
  const toast = useToast()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [draftError, setDraftError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState("")
  const [testing, setTesting] = useState(false)
  const [outcome, setOutcome] = useState<TestOutcome | null>(null)

  const load = useCallback(
    () =>
      api.getNotificationSettings().then(
        (s) => {
          setLoadError(null)
          setSettings(s)
          setRecipients(s.alert_email_to)
        },
        (err: unknown) => setLoadError(errorMessage(err))
      ),
    []
  )
  useEffect(() => {
    void load()
  }, [load])

  const dirty = settings !== null && recipients.join(",") !== settings.alert_email_to.join(",")

  const addDraft = () => {
    const values = draft
      .split(/[\s,;]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    if (values.length === 0) return
    const invalid = values.find((v) => !EMAIL_RE.test(v))
    if (invalid) return setDraftError(`“${invalid}” is not a valid email address`)
    const next = [...new Set([...recipients, ...values])]
    if (next.length > MAX_RECIPIENTS) return setDraftError(`At most ${MAX_RECIPIENTS} recipients`)
    setRecipients(next)
    setDraft("")
    setDraftError(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const s = await api.updateNotificationSettings(recipients)
      setSettings(s)
      setRecipients(s.alert_email_to)
      toast.success("Alert recipients saved", "The next alert email goes to the new list.")
    } catch (err) {
      toast.error("Could not save", errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    const to = testTo.trim().toLowerCase()
    if (to && !EMAIL_RE.test(to)) {
      setOutcome({ ok: false, message: `“${to}” is not a valid email address` })
      return
    }
    setTesting(true)
    setOutcome(null)
    try {
      setOutcome({ ok: true, result: await api.sendTestEmail(to || undefined) })
    } catch (err) {
      setOutcome({ ok: false, message: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={load} />

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 border-b p-4 sm:p-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
          <MailIcon className="size-4 text-sky-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Alert emails</h3>
            {settings && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  settings.email_enabled
                    ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                {settings.email_enabled ? "Enabled" : "Disabled"}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {settings
              ? `Sent for new and escalated ${settings.min_severity === "CRITICAL" ? "critical" : "warning or critical"} incidents.`
              : "Who gets notified when an incident opens."}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {/* Recipients */}
        <div className="space-y-2">
          <Label htmlFor="recipient-input" className="text-xs">
            Recipients
          </Label>
          {settings === null ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {recipients.map((r) => (
                <span
                  key={r}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs"
                >
                  <span className="truncate">{r}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${r}`}
                    disabled={recipients.length === 1}
                    onClick={() => setRecipients(recipients.filter((x) => x !== r))}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              id="recipient-input"
              type="email"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setDraftError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault()
                  addDraft()
                }
              }}
              placeholder="you@company.com"
              aria-invalid={draftError ? true : undefined}
              disabled={settings === null || recipients.length >= MAX_RECIPIENTS}
            />
            <Button variant="outline" onClick={addDraft} disabled={!draft.trim()}>
              <PlusIcon /> Add
            </Button>
          </div>
          {draftError ? (
            <p className="text-[11px] text-destructive">{draftError}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {settings?.source === "environment"
                ? "Currently using ALERT_EMAIL_TO from the server config. Saving here overrides it."
                : settings?.updated_at
                  ? `Saved ${timeAgo(settings.updated_at)}.`
                  : "Press Enter to add. Up to 10 addresses."}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            {dirty && (
              <Button variant="ghost" onClick={() => settings && setRecipients(settings.alert_email_to)} disabled={saving}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || saving}>
              {saving && <Spinner />}
              Save recipients
            </Button>
          </div>
        </div>

        {/* Test */}
        <div className="space-y-2 border-t pt-5">
          <Label htmlFor="test-to" className="text-xs">
            Send a test email
          </Label>
          <p className="text-[11px] text-muted-foreground">
            Sends right now and reports what the mail server answered. Leave the address empty to use the saved
            recipients{dirty ? " (save first to test the new list)" : ""}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="test-to"
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={settings?.alert_email_to.join(", ") ?? "you@company.com"}
            />
            <Button onClick={sendTest} disabled={testing || settings === null || !settings.email_enabled}>
              {testing ? <Spinner /> : <SendIcon />}
              Send test
            </Button>
          </div>
          {outcome && (
            <div
              role="status"
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
                outcome.ok
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              )}
            >
              {outcome.ok ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
              ) : (
                <XCircleIcon className="mt-0.5 size-4 shrink-0" />
              )}
              <div className="min-w-0">
                {outcome.ok ? (
                  <>
                    <div className="font-medium">Accepted by the mail server in {outcome.result.duration_ms} ms</div>
                    <div className="mt-0.5 break-words opacity-80">
                      Sent to {outcome.result.to.join(", ")}.{" "}
                      {settings?.smtp.host === "mailpit" || settings?.smtp.host === "localhost"
                        ? "Local dev: open Mailpit at http://localhost:8025 to read it."
                        : "Check that inbox (and its spam folder)."}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">Email was not sent</div>
                    <div className="mt-0.5 break-words opacity-90">{outcome.message}</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Server config */}
        {settings && (
          <details className="group rounded-lg border bg-muted/30 text-xs">
            <summary className="cursor-pointer list-none px-3 py-2.5 font-medium marker:hidden">
              Mail server (from server config)
              <span className="float-right text-muted-foreground group-open:hidden">Show</span>
              <span className="float-right hidden text-muted-foreground group-open:inline">Hide</span>
            </summary>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 border-t px-3 py-3 text-[11px] sm:grid-cols-2">
              <Row label="SMTP server" value={`${settings.smtp.host}:${settings.smtp.port}`} />
              <Row label="Encryption" value={settings.smtp.secure ? "TLS (SMTPS)" : "None / STARTTLS"} />
              <Row label="Login" value={settings.smtp.auth_configured ? "Username and password set" : "No login"} />
              <Row label="From" value={settings.from} />
            </dl>
            <p className="border-t px-3 py-2.5 text-[11px] text-muted-foreground">
              These come from SMTP_* and EMAIL_FROM in the server&apos;s .env and need an API and worker restart to
              change.
            </p>
          </details>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate font-mono">{value}</dd>
    </div>
  )
}
