# Mindspace

A mindfulness and meditation app built to the Mindspace PRD v1.0.0 — an Expo /
React Native client backed by a Node + PostgreSQL + Redis API.

All 17 screens from §4 of the PRD are implemented, wired to a real API, against
a real database, with a seeded content library.

```
mindspace/
├── apps/
│   ├── api/        Express + TypeScript API, raw SQL over node-postgres
│   └── mobile/     Expo SDK 57 app (iOS, Android, Web) using expo-router
├── packages/
│   └── shared/     The domain contract both sides import
└── docker-compose.yml   Postgres 16 + Redis 7
```

## Getting started

Requires Node 20+, pnpm, and Docker.

```bash
pnpm setup        # install, start Postgres + Redis, migrate, seed
pnpm api          # API on http://localhost:4000
pnpm mobile       # Expo — press w for web, or scan the QR code
```

`pnpm setup` is the four steps below rolled together, if you'd rather run them
individually:

```bash
pnpm install
pnpm infra:up      # docker compose up -d
pnpm db:migrate
pnpm db:seed
```

### Demo account

The seed creates an account with 43 days of practice history, so the Home feed,
streak, charts and heatmap all have something real to render:

```
demo@mindspace.app / mindspace
```

It is on Pro Annual with a part-finished Basics course. You can also tap **Try
for free** on the sign-in screen for a fresh guest account on the free tier —
useful for seeing the paywall behave.

### Ports

Postgres is on **5433** and Redis on **6381** rather than their defaults, so the
stack does not collide with other local databases. Change them in
`docker-compose.yml` and `apps/api/.env` together if you need to.

## The API

Runs on `:4000`. `GET /health` reports the status of both dependencies.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/{signup,login,guest,convert,refresh,logout,logout-all}` |
| User | `GET/PATCH /users/me`, `PATCH /users/me/preferences`, `PUT /users/me/onboarding`, `DELETE /users/me` |
| Content | `GET /content/sessions`, `/content/sessions/:id`, `/content/sessions/:id/stream`, `/content/collections[/:slug]` |
| Library | `GET/PUT/DELETE /content/favourites`, `/content/downloads`, `PUT /content/sessions/:id/rating` |
| Courses | `GET /courses`, `GET /courses/:slug`, `POST /courses/:slug/enroll` |
| Activity | `POST /activity/complete`, `GET /activity/history`, `POST/GET /activity/mood` |
| Companion | `GET /companion/status`, `POST /companion/chat` (SSE), `GET/DELETE /companion/conversations[/:id]` |
| Therapy | `GET /therapy/therapists[/:slug]`, `GET /therapy/therapists/:slug/slots`, `POST/GET/DELETE /therapy/appointments` |
| Teachers | `GET /content/teachers`, `GET /content/teachers/:slug` |
| Progress | `GET /stats`, `GET /home` |
| Billing | `GET /subscription/plans`, `POST /subscription`, `POST /subscription/restore`, `DELETE /subscription` |

### Notes on the implementation

**Days belong to the user, not the server.** Every user row carries an IANA
timezone, and each completion stores the calendar day it happened on *in that
zone*. Streaks, the heatmap and the daily recommendation all group on that
column, so someone in Auckland does not lose a day to UTC. See
`apps/api/src/lib/dates.ts`.

**The paywall is enforced server-side.** Browse responses blank the `streamUrl`
of Pro content for users without entitlement, `GET /sessions/:id/stream`
re-checks before handing one out, and `POST /activity/complete` checks again
before crediting minutes. The client's paywall screen is a convenience, not the
control.

**Mood notes are encrypted at rest.** PRD §5.2 treats mood data as health data,
so free-text notes are sealed with AES-256-GCM in the application layer before
they reach Postgres (`apps/api/src/lib/crypto.ts`). A database dump alone does
not reveal them.

**Streaks only tick once a day.** The first completion of a day sets
`streakIncreased`, so replaying a session does not re-fire the celebration or
re-award badges — the achievement insert is `ON CONFLICT DO NOTHING`.

**Courses cannot be skipped.** `recordCourseDay` advances progress only when the
finished day is exactly the next one, so completing day 5 before day 1 is
recorded as listening but does not move the course forward.

**Refresh tokens rotate.** Each use revokes the old token; presenting an
already-rotated token revokes the whole family, which is the standard response
to a stolen refresh token.

**Redis is optional.** It caches the home feed and backs the auth rate limiter.
If it is down the API logs a warning and continues — slower and unthrottled, but
serving.

**The AI companion's model is swappable by environment variable.** Every
backend implements one narrow interface (`apps/api/src/llm/types.ts`), so
moving between a frontier API and a model on your own hardware is config, not
code:

```bash
LLM_PROVIDER=anthropic   LLM_MODEL=claude-opus-5      ANTHROPIC_API_KEY=…
LLM_PROVIDER=openai      LLM_MODEL=gpt-5              OPENAI_API_KEY=…
LLM_PROVIDER=google      LLM_MODEL=gemini-2.5-flash   GOOGLE_API_KEY=…
LLM_PROVIDER=deepseek    LLM_MODEL=deepseek-chat      DEEPSEEK_API_KEY=…
LLM_PROVIDER=ollama      LLM_MODEL=llama3.1           OLLAMA_BASE_URL=http://localhost:11434/v1
```

Anthropic uses the official SDK; OpenAI, DeepSeek and Ollama share one
implementation because they speak the same wire format, so a self-hosted model
is the same code path rather than a degraded one. `GET /health` reports which
provider is live. With none configured the companion reports itself
unavailable and the rest of the app is unaffected.

**A crisis never reaches the model.** Messages are classified before anything
is sent anywhere; a crisis classification returns fixed, reviewed text with
verified helpline numbers and skips the model entirely — a language model must
not be what stands between someone and help. That path is never rate limited
and never behind the paywall, the classifier is deliberately over-sensitive,
and model output is screened on the way out so an invented helpline number
cannot reach a user. See `apps/api/src/llm/safety.ts`.

**Therapist licensing is enforced, not displayed.** Clinicians hold licences
per jurisdiction; booking someone not licensed where the client is returns 403
even though the directory already flags it. Slots are generated through the
therapist's IANA timezone rather than a fixed offset, so availability stays
correct across daylight-saving changes, and a partial unique index makes
double-booking impossible under concurrency rather than merely unlikely.

**Downloads are offline-first.** The device filesystem is the source of truth
for what is playable without a connection; the `/content/downloads` endpoints
exist to enforce the Pro entitlement and the 50-session cap, and to sync across
devices. A JSON index is written alongside the audio so the Downloads manager
still lists titles, durations and sizes in aeroplane mode — the one moment
someone actually checks. See `apps/mobile/src/store/downloads.ts`.

## The app

Expo SDK 57, `expo-router` file-based routing, `expo-audio` for playback,
`react-native-svg` for the charts, `zustand` for auth and player state.

| PRD screen | Route |
| --- | --- |
| 1–2 Splash & value prop | `src/app/(onboarding)/welcome.tsx` |
| 3 Sign up / log in | `src/app/(onboarding)/sign-in.tsx` |
| 4 Onboarding quiz | `src/app/(onboarding)/quiz.tsx` |
| 5 Home / Today feed | `src/app/(tabs)/index.tsx` |
| 6 Mood check-in | `src/app/mood.tsx` |
| 7 Explore | `src/app/(tabs)/explore.tsx` |
| 8 Category / collection | `src/app/collection/[slug].tsx` |
| 9 Session detail | `src/app/session/[id].tsx` |
| 10 Active player | `src/app/player.tsx` |
| 11 Post-session summary | `src/app/summary.tsx` |
| 12 Courses hub | `src/app/(tabs)/courses.tsx` |
| 13 Course detail | `src/app/course/[slug].tsx` |
| 14 Stats dashboard | `src/app/(tabs)/stats.tsx` |
| 15 Profile | `src/app/(tabs)/profile.tsx` |
| 16 Settings | `src/app/settings.tsx` |
| 17 Paywall | `src/app/paywall.tsx` |

Beyond the PRD's 17 screens, these close gaps found in
`docs/competitor-analysis.md`:

| Screen | Route | Gap it closes |
| --- | --- | --- |
| Unguided timer | `src/app/timer.tsx` | Calm ships a silent timer; we had none |
| Breathing exercises | `src/app/breathe.tsx` | Headspace opens sign-up with one |
| Teacher page | `src/app/teacher/[slug].tsx` | Calm bills its narrators prominently |

The app finds the API automatically: on web it uses `localhost`, and on a
physical device it reuses the LAN address Metro is already serving from. Set
`EXPO_PUBLIC_API_URL` to override.

## Known gaps

These are deliberate, and each is the point where a real deployment would plug
in a service that does not exist yet:

- **The catalogue's own audio does not exist yet.** The seeded sessions point at
  a CDN hostname that isn't real (see `docs/audio-production-brief.md` for the
  full asset list that needs producing). So that streaming, downloading and
  offline playback can all be exercised anyway, `src/offline/audio.ts` falls
  back to a single public demo track whenever the URL still points at the
  placeholder host. That fallback lives in exactly one file: once
  `CDN_BASE_URL` points somewhere real, the check stops matching and every
  session uses its own audio with no code change. If even the demo track is
  unreachable, the player runs the session on a wall-clock timer instead, so
  the flow still completes and still records real listening time.
- **Artwork is generated, not downloaded.** Cover art renders as a deterministic
  per-category gradient rather than shipping placeholder images.
- **Purchases are not verified.** `POST /subscription` is the
  post-verification step; a real build runs the store SDK first and validates
  the receipt against Apple/Google. The paywall sends a synthetic reference.
- **Apple / Google sign-in fall through to guest mode**, since both need native
  credentials that only exist in a signed build.
- **Reminders are stored but not delivered.** The schedule is persisted and
  indexed for a scheduler to sweep; the push worker itself is not built.
- **The library is 69 sessions**, not the 500+ of the PRD — enough to exercise
  every screen, filter and sort path.

## Gotchas worth knowing before you touch the toolchain

**The Jest family is pinned to 29 in `pnpm.overrides`.** `node-linker=hoisted`
(required for Metro) allows exactly one version per package name, so a
transitive dependency on Jest 30 silently replaces the Jest 29 that `jest-expo`
is built against. The failure is baffling rather than loud: a v30 config
normaliser feeding a v29 core reports `Pattern: undefined - 0 matches` and
finds no tests at all. Unpin only when `jest-expo` supports 30, and change the
whole family together.

**Jest configs are `.cjs` in the API.** That package is `"type": "module"`, so
a `.js` config is parsed as ESM and `module.exports` is undefined; a `.ts`
config needs `ts-node` installed and fails opaquely without it.

**`src/app.ts` has no side effects; `src/index.ts` is the bootstrap.** Tests
mount the former with supertest. Importing the latter binds a port and starts
the cron worker.

**If `tsc` cannot be found in a workspace package**, a stale binstub is the
usual cause after a TypeScript version change — delete that package's
`node_modules` and reinstall. Watch for it: the script exits 0 having checked
nothing, so a whole app can stop compiling without CI noticing. That is what
the `pnpm -r typecheck` step in CI now guards.

## Development

```bash
pnpm typecheck        # all three packages
pnpm --filter @mindspace/api dev
pnpm --filter @mindspace/mobile start
pnpm infra:reset      # wipe the database volumes and start clean
```

Migrations are checksum-locked: editing one that has already been applied fails
loudly rather than letting the database and the repo drift apart. Add a new
file in `apps/api/migrations/` instead.
