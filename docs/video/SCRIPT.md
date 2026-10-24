# API Monitor — 3-minute AI video kit

Everything to produce a **3:00 video, scene by scene**: narration, the exact image for every shot, a code card where
it helps, on-screen text, and a ready prompt for an image-to-video tool (Runway, Kling, Veo, Pika, Luma).

```
docs/video/
├── SCRIPT.md          ← this file (scenes + shot list + prompts)
├── voiceover.txt      ← narration only, paste into a TTS tool (ElevenLabs, etc.)
├── captions.srt       ← subtitles timed to the 3:00 cut
├── screens/           ← 1920×1080 app screenshots (01–11)
└── code/              ← 1920×1080 code cards (01–07), real code from this repo
```

## How to produce it (fastest path)

1. **Voice first.** Paste `voiceover.txt` into a TTS tool (a calm, confident male or female "narrator" voice,
   stability ~50 %, speed 1.0). Export one MP3. It runs about 2:45–3:00.
2. **One clip per shot.** For each shot below, upload the image to your image-to-video tool, paste the **Prompt**, set
   the **Duration**, 16:9, 1080p. Generate 2 takes, keep the one where text stays sharpest.
3. **Assemble** in CapCut / DaVinci / Premiere: drop clips in shot order, lay the voice-over on top, add
   `captions.srt`, cross-dissolve 6–8 frames between shots, soft music at −22 dB.
4. **Text must stay readable.** AI video models often warp UI text. Every prompt below asks for camera movement only.
   If a take still distorts text, skip AI for that shot: use the still image with a 105 % slow zoom in your editor
   ("Ken Burns"). Viewers cannot tell, and code cards always look better that way.

**Style for every shot:** dark UI, subtle blue glow, slow and steady camera, no people, no added objects, no new text.

**Negative prompt (paste wherever the tool allows it):**
`warped text, morphing letters, changing UI, new objects, people, hands, glitch, flicker, fast motion, zoom blur`

---

## Scene 1 · Hook — 0:00 → 0:12 (12 s)

> **VO:** "APIs rarely crash loudly. They slow down, return empty data, or quietly fail. API Monitor catches every one
> of those moments, and tells you why, in real time."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 1a | 0:00–0:06 | `screens/01-incidents.png` | 6 s | Slow cinematic push-in from wide to the center of a dark analytics dashboard, gentle parallax, soft blue light sweeping left to right, UI stays perfectly still and sharp. |
| 1b | 0:06–0:12 | `screens/01-incidents.png` | 6 s | Slow camera drift down from the four stat cards to the incident table, shallow depth of field, steady, the interface does not change. |

**On-screen text (1a, 0:01):** `API Monitor` · subtitle `Real-time anomaly detection for your APIs`

---

## Scene 2 · Detection — 0:12 → 0:32 (20 s)

> **VO:** "Every service streams its telemetry — status code, latency and records returned — into one endpoint. Eight
> deterministic rules check each sample: server errors, auth failures, high latency, empty or missing data, and more.
> No AI guessing here. Detection is plain, testable code."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 2a | 0:12–0:20 | `screens/03-simulator.png` | 8 s | Slow pan from left to right across a grid of scenario cards on a dark interface, steady and smooth, all text sharp. |
| 2b | 0:20–0:32 | `code/01-rules.png` | 12 s *(editor zoom)* | Very slow push-in toward the code window, faint glow on the title, code stays crisp. |

**Code shown:** `anomaly-engine/rules.ts` — the `SERVER_ERROR` and `AUTH_FAILURE` rules.

---

## Scene 3 · No alert spam — 0:32 → 0:50 (18 s)

> **VO:** "And it never spams you. Repeated failures are grouped by a fingerprint of the API and its symptoms, so a
> thousand bad responses become one incident with an occurrence count. If a warning turns critical, it escalates in
> place."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 3a | 0:32–0:40 | `code/02-dedup.png` | 8 s *(editor zoom)* | Slow push-in on the SQL `ON CONFLICT` block, steady. |
| 3b | 0:40–0:50 | `screens/01-incidents.png` | 10 s | Smooth camera move to the right side of the incident table, settling on the Count column and Critical badges, slight zoom, UI unchanged. |

**On-screen text (3b):** `1,000 failures → 1 incident`

---

## Scene 4 · The AI explains, never decides — 0:50 → 1:15 (25 s)

> **VO:** "Open an incident and you get a plain-English summary, a probable cause and a recommended fix, written by AI.
> But the AI only explains — it never decides. Its answer must be valid JSON, name the right API, and use only real
> numbers. If a provider fails, it switches from Gemini to OpenAI to Mistral, and if all are down, a built-in template
> takes over."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 4a | 0:50–1:00 | `screens/06-incident-ai-analysis.png` | 10 s | Slow push-in on a centered dialog over a dimmed dashboard, focus on the "Probable cause" and "Recommended action" sections, soft light, text stays sharp. |
| 4b | 1:00–1:15 | `code/03-ai-failover.png` | 15 s *(editor zoom)* | Slow vertical drift down the code from the provider loop to the final fallback line. |

**On-screen text (4a):** `AI explains. Code decides.` **(4b):** `Gemini → OpenAI → Mistral → template`

---

## Scene 5 · Save tokens, save money — 1:15 → 1:38 (23 s)

> **VO:** "AI costs money, so it only runs where it pays off: automatically for incidents that send an email.
> Everything else gets free, rule-based guidance — plus one click on Generate AI analysis when you want more. Same
> incident twice? The cached answer is reused, at zero cost."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 5a | 1:15–1:25 | `screens/07-incident-ai-on-request.png` | 10 s | Slow push-in toward the dashed box with the "Generate AI analysis" button, gentle highlight glow on the button, everything else still. |
| 5b | 1:25–1:38 | `code/04-token-saving.png` | 13 s *(editor zoom)* | Slow push-in on the filter that marks incidents SKIPPED. |

**On-screen text (5a):** `AI only where it pays off`

---

## Scene 6 · Live, with a built-in simulator — 1:38 → 1:55 (17 s)

> **VO:** "Everything is live. The dashboard updates over server-sent events the moment an incident changes — no refresh
> button. And a built-in simulator replays twelve real failure scenarios, so you can break things on purpose."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 6a | 1:38–1:46 | `code/05-live.png` | 8 s *(editor zoom)* | Slow push-in on the EventSource lines. |
| 6b | 1:46–1:55 | `screens/03-simulator.png` | 9 s | Camera glides from the "Continuous stream" panel down over the scenario cards, steady, sharp. |

**On-screen text (6b):** `12 failure scenarios · one click`

---

## Scene 7 · Straight to your inbox — 1:55 → 2:15 (20 s)

> **VO:** "Critical incidents go straight to your inbox through any SMTP provider — here, Gmail. Choose recipients in
> Settings, with no restart, and send a test email that reports exactly what the mail server answered."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 7a | 1:55–2:05 | `screens/08-email-test-success.png` | 10 s | Slow push-in toward the green "Accepted by the mail server" message, soft green glow, UI unchanged. |
| 7b | 2:05–2:15 | `code/06-email.png` | 10 s *(editor zoom)* | Slow pan across the .env lines to the send call. |

**On-screen text (7a):** `Email alerts · any SMTP · tested in one click`

---

## Scene 8 · Built to be trusted — 2:15 → 2:35 (20 s)

> **VO:** "Services shows each API's traffic, error rate and latency against its thresholds. And every sign-in, role
> change and resolution lands in the audit log, behind role-based access, rotating tokens and Argon2-hashed passwords."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 8a | 2:15–2:25 | `screens/02-services.png` | 10 s | Slow pan from the service names to the colored error-rate and p95 latency columns, steady, sharp text. |
| 8b | 2:25–2:35 | `screens/04-audit-log.png` | 10 s | Slow vertical drift down the audit log rows, colored event badges, calm and steady. |

**On-screen text (8b):** `RBAC · rotating refresh tokens · audit trail`

---

## Scene 9 · Every screen, fully documented — 2:35 → 2:48 (13 s)

> **VO:** "It works on every screen — tables on desktop, cards on your phone — and every endpoint is documented in
> OpenAPI with a live Swagger UI."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 9a | 2:35–2:42 | `screens/11-responsive-desktop-and-phone.png` | 7 s | Slow push-in toward the phone on the right, slight parallax between the laptop screenshot and the phone. |
| 9b | 2:42–2:48 | `screens/09-swagger-docs.png` | 6 s | Slow scroll-like drift down the API documentation page, steady. |

---

## Scene 10 · One command — 2:48 → 3:00 (12 s)

> **VO:** "Postgres, Redis, the API, the worker, the simulator and the dashboard — all start with one command, backed
> by over three hundred automated tests. That's API Monitor."

| Shot | Time | Image | Duration | Prompt |
| --- | --- | --- | --- | --- |
| 10a | 2:48–2:55 | `code/07-one-command.png` | 7 s *(editor zoom)* | Slow push-in on the terminal, green checkmarks glow softly. |
| 10b | 2:55–3:00 | `screens/01-incidents.png` | 5 s | Slow pull-back revealing the full dashboard, fade to black at the end. |

**End card (2:57):** `API Monitor` · `docker compose up` · your name / GitHub link

---

## Facts used in the narration (all true for this build)

| Claim | Where it comes from |
| --- | --- |
| 8 detection rules | `anomaly-engine/rules.ts` |
| One incident per API + symptom set | `anomaly-engine/fingerprint.ts`, upsert `ON CONFLICT` |
| Output guard (JSON, right API, no invented numbers) | `ai/output-guard.ts` |
| Gemini → OpenAI → Mistral → template | `ai/alert-enrichment.service.ts`, `AI_PROVIDER_ORDER` |
| AI only for emailed incidents, others on click | `AI_AUTO_ENRICH=email`, ADR-020 |
| Live updates over SSE | `hooks/use-alert-stream.ts`, `/api/v1/alerts/stream` |
| 12 simulator scenarios | `apps/simulator/src/scenarios/scenarios.ts` |
| Any SMTP provider, test email | `settings.service.ts`, Settings page |
| Argon2, rotating refresh tokens, audit log | `modules/auth`, `modules/audit` |
| 300+ automated tests | 197 unit · 100 integration · 14 contract |

## Notes on the images

- `01`–`05` are your screenshots, padded to 16:9. `06`–`11` were captured from the running app at 1920×1080.
- `08-email-test-success.png` shows a real earlier Gmail result. During capture the request was intercepted, so no
  extra email was sent.
- The code cards show real code; `03-ai-failover.png` is marked "simplified" because logging lines were removed.
