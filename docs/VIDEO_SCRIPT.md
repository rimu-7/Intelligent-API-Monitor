# Intelligent API Monitor — 5-minute demo video script

**Length:** 5:00 · about 700 spoken words (a calm 140 words per minute)
**Format:** screen recording with voice-over. **SHOW** = what is on screen. **SAY** = what you say, word for word or close to it.

---

## Before you hit record (10 minutes of prep)

1. Start everything: `docker compose up --build` and open http://localhost:3000. Sign in as admin.
2. **Never show `.env` on screen.** It holds your Gmail app password. Close it in your editor.
3. Make the incident list look alive: on the **Simulator** page click **Start stream** about 2 minutes before recording.
4. Open these tabs, in this order:
   - Tab 1: dashboard → **Incidents** (`localhost:3000/#alerts`)
   - Tab 2: **Gmail** inbox (jesseypinkman98@gmail.com), or have your phone next to you
   - Tab 3: **Swagger UI** `localhost:3001/docs`
   - Tab 4: the **README** on GitHub or in your editor, scrolled to the architecture diagram
5. Browser zoom 110–125% so text is readable on video. Hide bookmarks bar. Turn on Do Not Disturb.
6. Dark mode looks best (avatar menu → Dark mode).
7. Do one dry run with a timer. If a section runs long, cut words, not demo steps.

---

## 0:00 – 0:20 · Hook

**SHOW:** Incidents page with the stream running: counts ticking, a new row appearing. The "Live" dot in the header.

**SAY:**
> "APIs break quietly: a slow endpoint here, an empty response there. By the time someone notices, users already have.
> This is Intelligent API Monitor. It watches API telemetry in real time, spots anomalies, explains the likely cause
> with AI, and emails the team, all live, as it happens."

---

## 0:20 – 0:50 · What it is

**SHOW:** Slowly hover over the four stat cards: Active incidents, Critical, Resolved, Services.

**SAY:**
> "Services send their response telemetry (status code, latency, records returned) to one endpoint, `POST /monitor`.
> A deterministic engine checks every sample against eight rules: server errors, auth failures, high latency, empty or
> missing data, invalid metrics and more. Problems become incidents, and this dashboard updates the moment they change.
> No refresh button needed."

---

## 0:50 – 1:40 · Live demo: break something

**SHOW:**
1. On the Incidents page, in the **Telemetry simulation** bar, pick **Outage burst**, click **Run**.
2. Point at the toast, then at the new **AppointmentAPI** row appearing and the counts changing.
3. Point at the **Count** column (25 or more).
4. Click the **Critical** severity filter, then **Clear**. Click page **2** in the pagination.

**SAY:**
> "Let's cause an outage. This sends twenty-five failing requests from AppointmentAPI.
> Watch: the incident appears on its own, pushed over Server-Sent Events, and the counters update.
>
> Notice it's *one* incident, not twenty-five. Repeated failures are grouped by a fingerprint of the API and its
> symptoms, so the team gets one clear alert with an occurrence count, not alert spam. If a warning gets worse, it
> escalates to critical in place.
>
> Filters, sorting and pagination all run on the server, so this stays fast with ten incidents or ten thousand."

---

## 1:40 – 2:30 · The AI part

**SHOW:** Click the AppointmentAPI row to open the detail dialog. Point at "What happened", "Probable cause",
"Recommended action", and the provider label (e.g. "Mistral · ministral-8b-latest"). Click **Re-analyze**; the
skeleton lines appear, then the text comes back.

**SAY:**
> "Every incident gets a plain-English summary, a probable cause and a recommended next step, written by an LLM.
>
> One design rule matters here: **the AI explains, it never decides.** Detection and severity are pure, deterministic
> code. The model only writes text. And that text is checked by a guard: it must be valid JSON, name the right API,
> and every number it mentions must exist in the real data, so it can't invent figures.
>
> If a provider is slow or down, it fails over (Gemini, OpenAI, Mistral), each behind a circuit breaker. If all of
> them fail, a built-in template takes over. So an alert is never blocked waiting for AI.
> And AI only runs where it pays off: automatically for incidents that send an email, and for everything else with
> one click on **Generate AI analysis**. One call per incident, cached, never one per log line, so costs stay tiny."

---

## 2:30 – 3:05 · Email alerts

**SHOW:**
1. Sidebar → **Settings** → **Alert emails** card. Point at the recipient chip.
2. Click **Send test**. Point at the green "Accepted by the mail server in … ms".
3. Switch to the Gmail tab (or hold up your phone): show the test email, then a real **[CRITICAL]** alert email.

**SAY:**
> "Critical incidents are emailed automatically. Admins choose who gets them right here; no config files, no restart.
> And because email silently failing is the worst kind of failure, there's a test button that reports exactly what the
> mail server answered.
> …And here it is in my inbox, along with a real critical alert from the outage we just caused."

---

## 3:05 – 3:40 · How it's built

**SHOW:** The README architecture diagram (Tab 4). Trace the arrows with your cursor as you talk.

**SAY:**
> "Under the hood: a Node.js and TypeScript API with Express 5. PostgreSQL is the source of truth: every incident
> update happens in a single transaction. Redis runs the job queues, caching, rate limits and the live event bus.
> A separate worker does the slow work (AI enrichment and email) so ingestion stays fast.
> The dashboard is Next.js, and the whole stack (API, worker, database, Redis, simulator and frontend) starts with
> one command: `docker compose up`."

---

## 3:40 – 4:15 · Reliability and security

**SHOW:** Sidebar → **Audit log** (scroll a little), then **Team** (show Admin / Manager roles).

**SAY:**
> "It's built to be dependable.
> Retried requests are safe: idempotency keys mean the same batch is never counted twice. Stuck jobs are picked up by a
> reconciler, and only a signed-in user can resolve an incident.
>
> Access is role-based: admins and managers, deny by default. Logins use short-lived tokens with rotating refresh
> tokens and reuse detection, passwords are hashed with Argon2, brute-force attempts are throttled, and every
> sensitive action lands in this audit log.
> And it's backed by about three hundred automated tests: unit, integration and contract tests that keep the API and
> its documentation in sync."

---

## 4:15 – 4:40 · Polish: mobile and API docs

**SHOW:**
1. Open DevTools device mode (Cmd+Shift+M) → iPhone size. Show the incident **cards**, then open the ☰ menu.
2. Switch to Tab 3: Swagger UI at `/docs`. Expand one endpoint, e.g. `GET /api/v1/alerts`.

**SAY:**
> "On a phone, tables turn into cards and the menu slides in, so on-call engineers can triage from anywhere.
> And for developers, every endpoint is documented in OpenAPI with an interactive Swagger UI."

---

## 4:40 – 5:00 · Close

**SHOW:** Back to the Incidents page at desktop size, stream still running, incidents ticking.

**SAY:**
> "So that's Intelligent API Monitor: deterministic detection you can trust, AI that explains instead of guessing,
> and alerts that actually reach people, live, reliable, and running with one command.
> Thanks for watching."

---

## Quick reference: numbers you can quote (all true for this build)

| Claim | Value |
| --- | --- |
| Anomaly rules | 8 (server error, auth failure, invalid metrics, client error, high latency, missing records, zero records, unexpected status) |
| Default latency thresholds | warning 2,000 ms · critical 5,000 ms (per-API overrides) |
| Batch size limit | up to 1,000 samples per request |
| AI providers | Gemini → OpenAI → Mistral, then template fallback |
| Circuit breaker | 3 failures → provider paused for 60 s |
| AI cache | 24 hours, keyed on exact metrics |
| When AI runs | automatically only for emailed incidents; others on click |
| Emails per incident | at most 2 (new, and escalated) |
| Resolving | only by a signed-in user (auto-resolve is opt-in, off by default) |
| Simulator | 12 scenarios + a continuous stream |
| Automated tests | about 300 (195 unit, 94 integration, 14 contract) |

## If something goes wrong while recording

- **No new row after Run:** the stream may have hit its 10-minute limit. Click **Start stream** again, or run **Server error**.
- **AI text says "Rule-based summary":** that's the template fallback working as designed. Say so; it's a feature.
- **Test email fails:** the result box shows the reason. Re-record that section after fixing `.env` (off camera).
- **"Polling" instead of "Live" in the header:** the API restarted; it reconnects within seconds.
