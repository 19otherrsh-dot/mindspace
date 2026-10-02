# Competitor Analysis: Headspace & Calm vs. Mindspace

The two titans of the meditation market, and how Mindspace compares. The last
section tracks which gaps have been closed in the codebase and which remain
open decisions.

---

## 1. Headspace: The Friendly Guide

Headspace positions itself as an approachable, evidence-based guide to
meditation. It aims to demystify the practice and make it accessible to
beginners through structured courses.

**Core features**

- **Structured courses** — 500+ guided meditations organised into linear
  courses ("Basics", "Managing Anxiety").
- **Sleep support** — Sleepcasts, sleep music, wind-downs.
- **Mental health coaching** — licensed therapists and an AI chat companion
  ("Ebb").
- **Habit building** — "Mindful Moments" push notifications, progress tracking,
  streaks.

**UI & UX philosophy**

- **Emotion-driven design** — bright, playful palette (orange and yellow) with
  minimalist, friendly character illustrations.
- **Approachable** — avoids feeling like a clinical tool; acts as a welcoming
  friend.
- **Focused audio player** — clean and distraction-free, advanced settings
  tucked away.
- **Onboarding** — immediate engagement through a quick breathing exercise
  during sign-up.

---

## 2. Calm: The Serene Escape

Calm focuses on relaxation, stress relief and sleep. It acts less like a
structured teacher and more like a serene retreat, relying on atmospheric
design and celebrity-narrated content.

**Core features**

- **Sleep Stories** — the cornerstone, read by famous voices (Matthew
  McConaughey, Stephen Fry).
- **Flexible meditations** — Daily Calm sessions, plus guided and unguided
  ambient tracks.
- **Soundscapes & music** — an extensive ambient and nature-sound library.
- **Mood check-ins** — logged moods personalise recommendations.

**UI & UX philosophy**

- **Sensory immersion** — interactive, dynamic nature landscapes on the home
  screen with ambient audio playing immediately on open.
- **Colour psychology** — deep blues and greens to evoke tranquility and
  minimise visual agitation.
- **Minimalist aesthetic** — soft blurs, muted themes, generous whitespace: a
  "visual exhale".
- **Non-linear onboarding** — self-paced checklists rather than forced
  tutorials.

---

## 3. How Mindspace Compares

### Shared features (table stakes)

| Feature | Headspace | Calm | Mindspace |
| --- | :---: | :---: | --- |
| Guided sessions & courses | Yes | Yes | Yes — linear courses plus one-off sessions |
| Progress & streaks | Yes | Yes | Yes — timezone-aware tracking and heatmaps |
| Mood check-ins | Yes | Yes | Yes — end-to-end encrypted notes |
| Paywall & subscriptions | Yes | Yes | Yes — Pro vs Free tiers |

### Mindspace's competitive advantages

**Timezone-aware progress tracking.** Unlike apps that use UTC server time —
which can unfairly break a streak if you travel or meditate late at night —
Mindspace groups completions by the user's local IANA timezone. Fairer, and
much less frustrating for habit-building.

**Privacy-first mood tracking.** Calm uses mood check-ins for recommendation;
Mindspace treats mood and journal data as sensitive health information. All
free-text notes are AES-256-GCM encrypted at rest before reaching PostgreSQL.

**Gamification and UI aesthetics.** Mindspace leans into Headspace's structured
learning (strict course progression — days cannot be skipped) with a modern
Expo UI and fluid SVGs (progress rings, heatmaps) matching Calm's premium feel.

### Summary

- **Content structure** — closer to Headspace: structured courses with
  day-by-day enforced progression.
- **Visual & tracking** — stats dashboards, heatmaps and achievement badges
  take from modern fitness apps, a stronger gamification loop than Calm.
- **Data security** — application-layer encryption of user input is a real
  differentiator for anyone concerned about mental-health data privacy.

---

## 4. Gap closure log

What the analysis surfaced that Mindspace lacked, and what happened to it.

### Closed

| Gap | From | Implementation |
| --- | --- | --- |
| **Unguided timer** — a silent sit with interval bells, no narration | Calm | `apps/mobile/src/app/timer.tsx`. Modelled as seeded `unguided` sessions (migration 003) so a silent sit flows through the same completion, streak, history and achievement code as a guided one. Free on every tier — a timer behind a paywall is hostile. Excluded from browse, search and collections: it is a tool, not content. |
| **Breathing exercise, and one during onboarding** | Headspace | `apps/mobile/src/app/breathe.tsx`. Four patterns (4-7-8, box, calming, energising) with selectable round counts and haptic phase cues. The quiz now ends at `/breathe?onboarding=1`, so the first experience is practice rather than forms. |
| **Self-paced onboarding checklist** | Calm | `apps/mobile/src/components/getting-started.tsx`. Five optional tasks derived from real account state, in any order, disappearing for good once complete — replacing a forced tutorial. |
| **"Mindful Moments" reminders** | Headspace | `apps/mobile/src/notifications/reminders.ts`. Local notifications, so no push infrastructure and no device tokens; keeps working offline. Handles the platform split where `DAILY`/`WEEKLY` triggers are Android-only and iOS repeats via a calendar trigger. |
| **Narrator billing and browse-by-teacher** | Calm | `GET /content/teachers[/:slug]` plus `apps/mobile/src/app/teacher/[slug].tsx`. Instructors gained a `tagline` and `is_featured` (migration 003); Explore has a teachers row. Credentials stand in for celebrity licensing. |
| **Offline downloads** | Both | `apps/mobile/src/store/downloads.ts`. Filesystem is the source of truth, with a local JSON index so the manager works in aeroplane mode. |

| **AI companion** ("Ebb") | Headspace | Pluggable provider layer (`apps/api/src/llm/`) behind one interface: Anthropic on the official SDK, one shared implementation for OpenAI/DeepSeek/Ollama, and Gemini. Swapping — including to a self-hosted model — is an env change. Crisis classification runs *before* the model and bypasses it entirely, returning fixed text with verified helplines; that path is never gated or rate limited. Message bodies are encrypted at rest. |
| **Licensed therapists** | Headspace | Directory, per-jurisdiction licensing enforced at booking, timezone-correct slot generation, booking with Jitsi video (`apps/api/src/services/therapists.ts`). |
| **Streak insurance** | Neither — Calm's is a manual history edit | One rest day a calendar month, spent automatically when the user returns after exactly one missed day (`apps/api/src/services/streak.ts`, migration 007). Only ever bridges a one-day gap between two runs, and each spend is written rather than recomputed so the same gap cannot be forgiven twice. Cancellation typically follows a lost streak, and we gamified streaks heavily with nothing to absorb a bad day. |
| **The quiz answers doing something** | Both | Four of the five onboarding answers were stored and never read. `preferred_time` now sets the reminder, `daily_minutes` constrains the daily pick, `experience_level` folds in beginner content, `sleep_quality` promotes the sleep row. Headspace measured the commitment mechanic at +7.5% app opens. |
| **Pro as an offer, not a punishment** | Both | The paywall was only ever reached by colliding with a lock. It now also appears once at the end of onboarding, after the first breathing exercise, with declining as a visible button (`/paywall?offer=1`). |
| **Bedtime channel and wind-down** | Headspace | A second reminder on its own switch, time and Android channel, off by default at 22:00. Tapping it runs breathing then a sleepcast (`/start?mode=sleep`). |
| **Sleep check-ins** | Calm | `PUT/GET /activity/sleep`, one row per night, notes encrypted like mood (migration 008). Sleep was asked about once in onboarding and never measured again. |
| **Sleep timer and playback speed** | Calm | Timer shows only on sleepcast-style formats and ends the session rather than pausing, so the listening still counts toward the streak. Speed cycles 1× → 1.25× → 1.5× → 0.75× with pitch correction. |
| **One tap from intent to audio** | Headspace | `/start` resolves today's session and goes straight to the player; the reminder, the iOS widget and the home hero all reach it in one tap. |

### Open decisions

**The free catalogue has one duration.** Ten free meditations, all in
`beginners`, all exactly ten minutes; everything else is Pro. So the length
preference the quiz collects has nothing to choose between on the tier most
users experience first. The pick falls back to the closest available length and
stops claiming a fit it did not achieve, but this is a content decision.

**A dated daily original.** Calm ships a genuinely new session every day, which
is a pull reason independent of the streak. Ours is a recommendation drawn from
a static library — it can repeat, and users notice. This is a content-operations
commitment rather than an engineering task.

**Three tabs or five.** Headspace ran this experiment and simplified from
category tabs to Today / Explore / Profile. We have five; Courses and Stats are
both reachable from elsewhere. Worth testing rather than assuming.

**Celebrity narrators.** Calm's Sleep Stories depend on talent deals. The
schema now supports billing a narrator prominently; who gets billed is a
licensing question.

**Payments for therapy.** Sessions carry a price and currency, but no charge is
taken — no payment processor, no clinician payouts, no refund policy. That is
a commercial integration, not a coding gap.

**Clinician-side tooling.** Therapists have no login: availability, time-off
and licences are seeded rather than self-managed, and there is no session-notes
surface. A real deployment needs a clinician portal and the regulated
record-keeping that comes with it.

**Crisis coverage is three regions deep.** Verified helplines exist for the US,
UK and India, with an international directory as fallback. Every additional
launch region needs its numbers verified by a human before launch — this list
is deliberately not model-generated.

**Sensory immersion.** Calm's animated landscapes and instant ambient audio are
partially matched (gradient artwork, a pulsing home backdrop, an ambient loop
on open). Going further means commissioning motion artwork — and auto-playing
audio on launch is worth A/B testing rather than assuming: it delights some
users and startles others, particularly on a phone in a quiet room.
