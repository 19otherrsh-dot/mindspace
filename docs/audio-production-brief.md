# Mindspace — Audio Production Brief

Every audio asset the app expects, with enough context to generate each one.

This is written to be handed to a generation pipeline (LLM for scripts, TTS for
narration, music model for beds and soundscapes) or to a human production team.
Each entry states what the piece is *for* — the user's situation at the moment
they press play — because that decides the script far more than the title does.

**Status: none of this audio exists yet.** The seeded catalogue points at
`cdn.mindspace.example.com`, which is not a real host. The player detects the
failed stream and falls back to a wall-clock timer, so the app is fully usable
but silent. Delivering these files against the naming convention in §9 is the
single change that turns the timer back into audio.

---

## 1. What has to be produced

| Format | Items | Runtime | Narrated | Notes |
| --- | ---: | ---: | :---: | --- |
| `meditation` | 43 | 436 min | yes | Includes the 10-part Basics course |
| `sleepcast` | 6 | 300 min | yes | Long-form sleep narratives, 45–55 min |
| `sleep_music` | 4 | 180 min | no | Instrumental / field recording |
| `focus_music` | 4 | 190 min | no | Instrumental |
| `mini` | 5 | 9 min | yes | 1–2 min resets |
| `movement` | 4 | 45 min | yes | Spoken instruction, physical |
| `wind_down` | 3 | 60 min | yes | Composite: movement → breath → stillness |
| **Catalogue total** | **69** | **1,220 min** | 61 voiced | ≈ 20.3 hours |
| Background mixer loops | 4 | seamless | no | §8 — not in the database |
| UI / celebration cues | 3 | < 3 s each | no | §8 — optional |

Two multipliers to decide before committing to a word count — see §5:

- **Voice packs.** PRD §3.1 offers a choice of narrator. Taken literally that is
  61 voiced pieces × 3 tones = **183 narrations**.
- **Audio quality tiers.** Settings exposes Standard and High, so every asset
  needs two renditions in the HLS ladder. That is an encode step, not a
  re-record.

---

## 2. Global technical specification

Delivery is CDN-hosted HLS (PRD §5.1), with encrypted local copies for offline
(PRD §3.1, §5.1).

| Property | Value |
| --- | --- |
| Master | 48 kHz, 24-bit WAV, mono for pure narration, stereo where there is a bed |
| Delivery | HLS (`master.m3u8`) with two AAC-LC renditions |
| "Standard" rendition | 64 kbps AAC, mono-compatible |
| "High" rendition | 128 kbps AAC stereo |
| Segment length | 6 s (balances seek accuracy against request count) |
| Head/tail silence | 0.5 s lead-in, 2 s tail — the player's completion fires on the true end |

### Loudness targets

Meditation is listened to at low volume, often in bed. Mastering it like a
podcast makes it aggressive. Targets differ by intent:

| Content | Integrated | True peak | Rationale |
| --- | --- | --- | --- |
| Guided meditation, mini, movement | −18 LUFS | −1.5 dBTP | Clear at low volume without forcing the listener to ride the dial |
| Sleepcast, wind-down | −22 LUFS | −2 dBTP | Must not startle someone drifting off |
| Sleep music | −23 LUFS | −2 dBTP | Sits under the room |
| Focus music | −20 LUFS | −1.5 dBTP | Competes with an office, but stays background |

**Dynamic range matters more than level.** Keep narration within roughly 6 dB
peak-to-average; a sudden loud consonant at 2 a.m. undoes the whole session. No
limiting that pumps. No de-esser artefacts — sibilance is the single most
common complaint in this category.

### Silence is content

The most common failure in AI-generated meditation is talking too much. Word
budgets, assuming unhurried delivery and real pauses:

| Duration | Word budget | Speaking density |
| --- | ---: | --- |
| 1 min | 60–80 | Dense — no room to wander |
| 2 min | 110–140 | One instruction, repeated once |
| 3 min | 150–190 | ~55 wpm |
| 5 min | 230–290 | ~50 wpm |
| 10 min | 420–500 | ~45 wpm |
| 15 min | 580–700 | ~42 wpm |
| 20 min | 750–900 | ~40 wpm |
| Sleepcast 45–55 min | 2,800–3,800 | ~65 wpm, then trailing off |

Pauses of 8–20 seconds between instructions are normal and correct in the
middle third of any session over 10 minutes. Mark them explicitly in the script
as `[pause 15s]` so TTS timing survives into the render.

---

## 3. Narrator voice profiles

Six instructors carry the catalogue. Each needs a consistent, castable voice —
these descriptions are written to be usable directly as TTS voice-selection or
voice-cloning direction.

**Nadia Okoye** — *stress, mini resets.* Former ER nurse. Mid-30s to 40s, warm
mid-range female voice, British-Nigerian. Unhurried but not floaty; carries the
authority of someone who has been in genuinely stressful rooms. Slight downward
inflection at phrase ends — settling, not questioning. Assigned tone: `calm`
for stress meditations, `warm` for minis.

**Tom Hale** — *beginners, the Basics course.* 40s–50s, male, plain northern
English. The most conversational voice on the platform: he explains rather than
intones, and he is the antidote to people who find meditation apps twee. Almost
no vocal fry, no whispering, no reverence. Assigned tone: `neutral`.

**Mira Castellanos** — *sleep, sleepcasts, wind-downs.* 30s–40s, female, soft
Spanish-accented English. Low, slightly breathy, very slow. This is the voice
that must be able to go quieter and slower across 50 minutes without becoming
inaudible. Assigned tone: `calm`.

**Jonas Berg** — *focus, sports.* 30s–40s, male, light Scandinavian accent.
Direct, economical, coach-like. Shorter sentences than anyone else on the
platform. Never soothing — he is helping you do something, not relax. Assigned
tone: `neutral`.

**Priya Raman** — *anxiety, relationships.* 30s–40s, female, Indian-British.
Clinical psychologist. The warmest voice here; the register is "someone sitting
with you", not "someone instructing you". Handles difficult emotional content
without dropping into pity. Assigned tone: `warm`.

**Sam Whitfield** — *mindful movement.* 30s–40s, gender-neutral delivery,
general American. Bright, practical, physically present — you should be able to
hear that they are demonstrating the movement while speaking. Assigned tone:
`neutral`.

### Universal delivery rules

- Second person, present tense. "You're noticing…" not "We will now notice…"
- No permission-seeking ("if you'd like to, maybe try…"). Offer, don't hedge.
- No claims of clinical outcome. Never "this will cure your anxiety".
- Never assume posture, ability, sight, or a quiet room. "Settle into a position
  that works" beats "sit cross-legged on the floor".
- Never assume the user is alone or at home.
- Breath instructions are invitations, never counts the user must keep up with —
  paced breathing at the wrong rate causes anxiety in some listeners.

---

## 4. Structural templates

Use these arcs rather than inventing one per script.

**Guided meditation (3–20 min)**
1. *Arrival* (10% of runtime) — orient, settle posture, one long exhale.
2. *Anchor* (20%) — establish the object of attention (breath, body, sound).
3. *Body* (50%) — the actual practice, with the longest silences here.
4. *Widening* (10%) — broaden attention outward.
5. *Return* (10%) — re-orient to the room, no abrupt ending.

**Mini (1–2 min)** — no arrival, no return. Straight into one instruction,
repeat it once, done. The user is in a stairwell.

**Sleepcast (45–55 min)** — Headspace-model, three phases:
1. *Wind-down* (3–4 min) — direct address, breath, permission to stop listening.
2. *Narrative pass one* (18–22 min) — descriptive, second-person, present tense,
   zero plot and zero jeopardy. Sensory detail only.
3. *Narrative pass two* (20–28 min) — **the same narrative again**, progressively
   slower, quieter, and more sparse, trailing into the ambient bed. Most
   listeners never hear the end, which is the point.

**Movement (8–15 min)** — cue the movement *before* it happens, hold, then
release. Always name the alternative for a body that cannot do it.

**Wind-down (20 min)** — 7 min light movement → 7 min breath → 6 min stillness,
crossfaded, no announcements between phases.

**Instrumental (25–90 min)** — no arc. Any perceptible event (a swell, a key
change, an arrival) breaks it. See §7.

---

## 5. The voice-pack decision

PRD §3.1 promises "voice packs: choose from multiple narrators". The schema
carries a `voice_pack` on each session and a `preferred_voice_pack` on each
user, and Settings exposes the picker — but as seeded, **each session has
exactly one voice**, so the preference currently has nothing to switch between.

Three options, in ascending cost:

1. **Ship as-is.** The picker becomes a filter that biases recommendations
   toward sessions already in the chosen tone. Cheapest; mildly dishonest
   against the PRD wording. Requires a small query change, no new audio.
2. **Duplicate the core only.** Re-record the 10 Basics sessions and the 5 minis
   in all three tones (15 × 3 = 45 narrations, ~35 min of unique script). Gives
   a real choice where new users actually land.
3. **Full parity.** All 61 voiced pieces × 3 = **183 narrations**, ~2,900 min of
   rendered audio from ~975 min of unique script.

**Recommendation: option 2.** The picker is most valuable to a beginner deciding
whether they can stand the voice for ten days; it is nearly worthless on a
sleepcast they will hear twice. Ship 45 narrations, not 183.

---

## 6. Narrated catalogue

Format per entry:

> **`slug`** · *Title* — duration · narrator · tone
> **Situation** — where the user's head is when they press play.
> **Arc** — the beats to write.
> **Direction** — what to do and avoid in delivery.

### 6.1 Basics course (10 × 10 min · Tom Hale · neutral · FREE TIER)

These ten are the most important assets in the catalogue. They are the entire
free tier, they carry the App Store rating, and they are the only content most
churned users ever hear. Budget the most script effort here.

Sequential — each may reference the day before, never a later day.

**`basics-day-1`** · *Day 1: Getting Started* — 10 min
**Situation** — Has never meditated. Slightly embarrassed to be trying. Half
expects to be told to empty their mind.
**Arc** — What you are actually doing and why it works (3 min of plain talk,
unusually front-loaded) → settle → 4 min of simple breath attention → return.
**Direction** — Tom's warmest, most conversational take. Explicitly kill the
"clear your mind" myth in the first ninety seconds. No Sanskrit, no bells.

**`basics-day-2`** · *Day 2: The Breath* — 10 min
**Situation** — Came back, which is the hard part. Wants to know if there is a
right way to breathe.
**Arc** — Brief callback to day 1 → why breath is the anchor → find where it is
most obvious (nose, chest, belly) → 5 min sustained attention.
**Direction** — Say early and plainly: do not control the breath, just watch it.

**`basics-day-3`** · *Day 3: Wandering* — 10 min
**Situation** — Has now noticed their mind wanders constantly and assumes they
are failing. **This is the highest-churn day in the course.**
**Arc** — Reframe hard and early: noticing you wandered *is* the rep → practise
deliberately noticing → 5 min with explicit permission to drift and return.
**Direction** — The single most important message in the whole course. Warm,
slightly amused, absolutely not disappointed.

**`basics-day-4`** · *Day 4: The Body Scan* — 10 min
**Arc** — Introduce a second anchor → feet to head, unhurried → rest in whole-body
awareness.
**Direction** — Name each region once. Do not linger anywhere long enough to
create anxiety about that region.

**`basics-day-5`** · *Day 5: Noting* — 10 min
**Arc** — Introduce silent labelling ("thinking", "hearing", "feeling") → practise
→ drop the label, keep the noticing.
**Direction** — Emphasise one-word labels. Users over-narrate this technique.

**`basics-day-6`** · *Day 6: Difficult Feelings* — 10 min
**Situation** — Practice has started surfacing things. May be unsettled.
**Arc** — Normalise it → locate the feeling as physical sensation → stay at the
edge, not the centre → return to breath as refuge.
**Direction** — Careful safety framing: explicitly permit stopping, opening the
eyes, or leaving it for another day. Include a plain line pointing toward real
support if something big surfaces. No therapeutic claims.

**`basics-day-7`** · *Day 7: Off the Cushion* — 10 min
**Arc** — Shorter sit (5 min) → how to carry attention into washing up, walking,
queueing → one concrete assignment for today.
**Direction** — Practical and specific. Name real, mundane activities.

**`basics-day-8`** · *Day 8: Patience* — 10 min
**Situation** — A week in and it does not obviously "work" yet. Second churn peak.
**Arc** — Name the plateau directly → why progress is not linear → 6 min sit with
no goal at all.
**Direction** — Honest, not motivational. Do not promise results.

**`basics-day-9`** · *Day 9: Kindness* — 10 min
**Arc** — Introduce self-compassion → a simple well-wishing phrase toward oneself
→ extend to one other person.
**Direction** — Keep it grounded. Offer a neutral phrase for anyone who finds
"may I be happy" unbearable — many British and Northern European users do.

**`basics-day-10`** · *Day 10: Keeping Going* — 10 min
**Arc** — Brief closing sit → what actually makes a habit stick (cue, size,
forgiveness after a miss) → where to go next.
**Direction** — Warm close. One clear next step. Do not upsell inside the audio —
the app handles that.

### 6.2 Stress — Nadia Okoye · calm

**`letting-the-day-go`** · *Letting the Day Go* — 3 min
**Situation** — Just walked in the door, still carrying the day in their jaw and
shoulders.
**Arc** — Arrive → jaw, shoulders, hands in turn → one long exhale each → done.
**Direction** — Brisk for Nadia. This is a doorway practice, not a sit.

**`breathing-room`** · *Breathing Room* — 5 min
**Situation** — Everything feels close and stacked up.
**Arc** — Notice the crowding → lengthen the exhale → find the gap between
stimulus and response → rest there.
**Direction** — The word "space" should be felt, not repeated. Use it sparingly.

**`the-pressure-valve`** · *The Pressure Valve* — 10 min
**Situation** — Something difficult is coming today: a presentation, a review,
a confrontation.
**Arc** — Name the pressure without rehearsing the event → physical discharge
(shoulders, breath) → steady attention → walk in.
**Direction** — Do not let the script rehearse the feared event; that raises
arousal rather than lowering it.

**`unclenching`** · *Unclenching* — 15 min
**Situation** — Chronically tense, has stopped noticing it.
**Arc** — Slow scan hunting specifically for held tension → soften each site →
whole-body release → rest.
**Direction** — Longest silences of the stress set. Let the body do the work.

**`after-the-storm`** · *After the Storm* — 20 min
**Situation** — The hard thing is over but the body has not caught up.
**Arc** — Acknowledge it is finished → down-regulate deliberately → long settling
→ gentle re-entry.
**Direction** — Slowest of Nadia's set. The message underneath is *you are safe
now*, delivered without ever saying it.

### 6.3 Anxiety — Priya Raman · warm

**`ground-beneath-you`** · *Ground Beneath You* — 3 min
**Situation** — Spiralling, needs out of their head *now*.
**Arc** — Feet on floor → five senses, quickly → back to the room.
**Direction** — Concrete and external throughout. Nothing introspective.

**`before-the-meeting`** · *Before the Meeting* — 3 min
**Situation** — Two minutes in a stairwell before walking into something.
**Arc** — Feet, breath, one steadying thought → go.
**Direction** — Efficient. See §10 — the subtitle says two minutes but the asset
is three; reconcile before recording.

**`the-worry-loop`** · *The Worry Loop* — 5 min
**Situation** — Same thought, fifteenth lap.
**Arc** — Notice the loop → name it as a loop, don't argue with it → let it
circle without joining → return to breath.
**Direction** — Never debate the worry's content. The practice is disengagement,
not reassurance.

**`steady-hands`** · *Steady Hands* — 10 min
**Situation** — Physical anxiety — racing heart, shallow breath, restless hands.
**Arc** — Start with the body, not the mind → extend the exhale → hands and jaw →
let the heart rate follow.
**Direction** — Explicitly permit a racing heart to keep racing for a while.
Fighting it is what sustains it.

**`nothing-to-fix`** · *Nothing to Fix* — 15 min
**Situation** — Exhausted by trying to solve how they feel.
**Arc** — Drop the fixing agenda → sit with discomfort at a tolerable distance →
notice it changing on its own.
**Direction** — Priya's most spacious script. Resist offering technique.

**`kind-to-yourself`** · *Kind to Yourself* — 20 min
**Situation** — Has been brutal to themselves today.
**Arc** — Notice the inner critic's tone → what you'd say to a friend → turn it
inward → rest in it.
**Direction** — Genuinely warm, never saccharine. Offer an opt-out phrase for
users who find self-compassion language difficult.

### 6.4 Sleep meditations — Mira Castellanos · calm

**`falling-away`** · *Falling Away* — 5 min
**Arc** — Lying down → release the day in layers → descend.
**Direction** — Never instruct the listener to fall asleep. Permit it.

**`the-long-exhale`** · *The Long Exhale* — 10 min
**Arc** — Establish breath → progressively extend the exhale → let the count go.
**Direction** — Pace the exhale by voice rhythm, not by numbers.

**`nightly-reset`** · *Nightly Reset* — 15 min
**Situation** — Mind starts working the moment the light goes off.
**Arc** — A brief, deliberately boring review of the day → close each thread →
put it down → stillness.
**Direction** — The review must not become interesting. Flatten it.

**`back-to-sleep`** · *Back to Sleep* — 20 min
**Situation** — Awake at 3 a.m. This is a genuinely distinct design problem.
**Arc** — No greeting, no orientation, no context → straight into body and breath
→ long, formless drift.
**Direction** — **Critical:** nothing to remember, no instruction requiring
effort, no reference to morning or time. Starts already quiet — the listener
fumbled for the phone in the dark. Absolutely no bright ideas.

### 6.5 Focus — Jonas Berg · neutral

**`morning-sharpening`** · *Morning Sharpening* — 3 min
**Arc** — Before the inbox → one intention → sharpen attention → go.

**`single-point`** · *Single Point* — 5 min
**Arc** — One object → return, return, return → count the returns as reps.
**Direction** — Frame wandering explicitly as training, not failure.

**`clearing-the-desk`** · *Clearing the Desk* — 10 min
**Arc** — Mark the boundary from everything else → park open loops → name the one
task → begin.
**Direction** — Ends pointing at work, not at rest. Slightly more energy at the
close than the open — the only session in the catalogue that does this.

**`the-long-read`** · *The Long Read* — 15 min
**Arc** — Settle for sustained work → widen attention capacity → hold → release
into the task.
**Direction** — Pairs with `focus-deep-work`; do not fight that bed.

**`refocus`** · *Refocus* — 20 min
**Situation** — Interrupted, and attention did not come back on its own.
**Arc** — Acknowledge the break → discharge residual irritation → rebuild
attention deliberately → resume.

### 6.6 Relationships — Priya Raman · warm

**`before-the-conversation`** · *Before the Conversation* — 3 min
**Arc** — Settle → set the intention to listen, not to win → go in.

**`letting-them-be-wrong`** · *Letting Them Be Wrong* — 5 min
**Arc** — Notice the need to be conceded to → hold your position without it →
release the demand.
**Direction** — Do not imply the listener is wrong. Nor that the other person is.

**`repair`** · *Repair* — 10 min
**Situation** — Hours after an argument they handled badly. Oscillating between
defending and disappearing.
**Arc** — Sit with the discomfort of having got it wrong → separate the act from
the self → find one repairable thing.
**Direction** — No absolution, no self-flagellation. Steady.

**`loving-kindness`** · *Loving Kindness* — 15 min
**Arc** — Classic metta: self → someone easy → someone neutral → someone
difficult → all.
**Direction** — Taught plainly, as Priya would. Offer plain-English phrases. Do
not go near the "difficult person" stage aggressively.

### 6.7 Sports — Jonas Berg · neutral

**`in-the-set`** · *In the Set* — 3 min
**Situation** — Rest interval. Breathing hard.
**Arc** — Recover breath → recover attention → next effort.
**Direction** — Written to be listenable while physically working. Short lines.

**`the-wall`** · *The Wall* — 5 min
**Situation** — The point where the mind quits before the body does.
**Arc** — Name the voice that wants to stop → separate sensation from story →
one more unit of effort.
**Direction** — Not hype. Jonas does not shout. Level and factual.

**`after-the-loss`** · *After the Loss* — 10 min
**Arc** — Let the result be bad → separate performance from identity → what is
usable from it → set it down.
**Direction** — No silver linings in the first half.

**`pre-race-calm`** · *Pre-Race Calm* — 20 min
**Situation** — Start line. Adrenaline is already up.
**Arc** — Accept the arousal as fuel, not a fault → channel it → narrow focus →
hold until the gun.
**Direction** — Never try to make the listener calm *down*. Make the activation
usable.

### 6.8 Standalone beginner sessions — Tom Hale · neutral

Distinct from the Basics course; these are browsable entry points.

**`when-your-mind-wanders`** · 3 min — the day-3 message as a standalone.
**`sitting-comfortably`** · 5 min — posture without the fuss. Explicitly cover
chairs, beds, lying down, and bodies with pain or limited mobility.
**`making-it-a-habit`** · 10 min — mostly talk, minimal sit. Habit mechanics.
**`what-meditation-actually-is`** · 15 min — the longest talk-to-practice ratio in
the catalogue. Clears away mysticism. Roughly 8 min explanation, 5 min practice,
2 min close.
**`noticing-the-breath`** · 20 min — a full-length first practice for someone who
wants to go straight in. Unusually heavy scaffolding for its length.

### 6.9 Mini meditations — Nadia Okoye · warm

Ruthless compression. No arrival, no return, no metaphor. One instruction.

**`three-breaths`** · 1 min · anxiety — literally three guided breaths. ~70 words.
**`sixty-seconds`** · 2 min · stress — one minute of nothing, held open by voice
at the start and end only. See §10: the title says sixty seconds, the asset is
two minutes.
**`doorway-pause`** · 2 min · stress — between one thing and the next. Threshold
framing.
**`traffic-light`** · 2 min · stress — for time the user already has, stationary.
Must be safe for a driver: **no eye-closing instruction**, no body scan, nothing
requiring attention off the road. State this constraint in the script.
**`desk-reset`** · 2 min · focus — without leaving the chair, without looking
like you are meditating in an open-plan office.

### 6.10 Mindful movement — Sam Whitfield · neutral

Spoken instruction for a moving body. Cue *before* the movement, hold, release.
Every movement needs a stated alternative — seated, supported, or skipped.
No counting reps. No "push through".

**`neck-and-shoulders`** · 8 min — for screen-shaped posture. Seated throughout,
doable at a desk in work clothes.
**`standing-stretch`** · 10 min — away from the desk, one metre of floor space,
no mat.
**`morning-mobility`** · 12 min — waking the body. Slightly brighter delivery;
the only movement piece that raises energy.
**`wind-down-stretch`** · 15 min — slow, floor or bed, pre-sleep. Delivery closer
to Mira's register than Sam's usual. Ends lying down.

### 6.11 Wind-down routines — Mira Castellanos · calm

20 min each, three phases crossfaded with no announcements: ~7 min light
movement → ~7 min breath → ~6 min stillness. The listener should not notice the
seams. Each ends without a close — it hands off to sleep or to a sleepcast.

**`wind-down-standard`** · the default sequence.
**`wind-down-screens-off`** · for late-night workers. Opens by addressing the
just-closed laptop; more deliberate cognitive offloading in the breath phase.
**`wind-down-restless`** · tired but wired. More physical discharge up front —
the body has energy that must go somewhere before stillness is possible.

### 6.12 Sleepcasts — Mira Castellanos · calm

Six long-form narratives, 45–55 min. Structure per §4: wind-down, then the same
story twice, the second pass slower, quieter and sparser until it dissolves into
the bed.

Hard rules for all six:
- **No plot. No jeopardy. No characters who want anything.** Description only.
- Second person, present tense, but the listener never acts and is never
  addressed with a question.
- No named people, no dialogue, no time pressure, no arrivals or departures.
- Sensory detail weighted to sound and temperature, then touch. Very little
  visual — closed eyes.
- Nothing that could read as threatening: no darkness *closing in*, no cold that
  bites, no isolation framed as loneliness.
- The bed is inseparable from the narration; produce them together.

**`sleepcast-rainforest-canopy`** · 45 min — *A night high in the trees.* Rain
moving through the canopy above, the forest floor settling below. Layered rain
at different distances, occasional heavy drops from leaves. Warm, humid, held.

**`sleepcast-night-train`** · 45 min — *Rolling through the dark.* Rhythm of rail
joints, an almost-empty carriage, unlit stations passing. The rhythm is the
sedative; keep it metronomic and never accelerate. No destination, no arrival.

**`sleepcast-harbour-town`** · 50 min — *Boats knocking gently at the dock.*
Tide against hulls, rigging, a lighthouse turning, the town going quiet one
window at a time. Water sounds close and small, not oceanic.

**`sleepcast-desert-sky`** · 50 min — *Cooling sand and open stars.* Heat leaving
the ground, enormous sky, near silence. The sparsest of the six — the least
sound, the widest space. Emptiness as comfort, never as isolation.

**`sleepcast-the-cabin`** · 55 min — *Snow against the windows.* Fire settling in
the grate, snow accumulating, nowhere to be. The warmest and most enclosed.
Occasional log shifts — keep them soft, never a crack.

**`sleepcast-lakeside`** · 55 min — *Water against a wooden jetty.* Small waves
on wood, distant loons, the particular stillness of a lake after dark. Most
minimal water treatment of the set.

---

## 7. Instrumental catalogue

No narration. No arc, no events, no resolution — anything the ear can anticipate
or notice becomes something to attend to, which defeats the purpose.

Composition rules:
- **No perceptible structure.** No key change, no build, no drop, no arrival.
- **No melody a listener could hum.** Melodic fragments create expectation.
- Seamless loop-capable, or genuinely through-composed for the full duration.
- No sudden onsets. Attack times ≥ 200 ms on everything.
- Low end rolled off below ~40 Hz — phone speakers turn it to distortion.
- Sleep beds: nothing above ~8 kHz that could register as a hiss or a whisper.

### Sleep music

**`binaural-drift`** · 30 min — *Low tones for deep sleep.* Binaural beat bed,
carrier ~100–200 Hz, delta offset (1–4 Hz). **Requires stereo and a headphone
notice in the description** — the effect does not exist on a speaker, and the
app should say so. Make no clinical claim about it.

**`deep-rain`** · 45 min — *Steady rainfall, no thunder.* Consistent mid-density
rain, no downpour swells, **no thunder at any point** — the title is a promise.
Layer close patter with distant wash.

**`night-wind`** · 45 min — *Air moving through open country.* Wind without
whistling or howling. Grass and distance. Nothing that resembles a voice.

**`ocean-shelf`** · 60 min — *Slow swell on a distant shore.* Long-period swell,
7–10 s cycle. Distant, not beach-front — no gravel drag, no gulls.

### Focus music

Must survive being ignored for 90 minutes and must not compete with language
processing — **no vocals, no lyrics, no vocal samples, not even wordless ones.**

**`focus-deep-work`** · 25 min — *Warm ambient pads.* One Pomodoro. Warm, slightly
analogue, gently evolving. Ends without a cadence.

**`focus-library`** · 25 min — *Quiet room tone and soft texture.* The most
minimal: barely-there texture over a convincing room tone. For people who find
even ambient music intrusive.

**`focus-flow-state`** · 50 min — *Minimal pulse, no melody.* A soft, steady
pulse around 60–70 BPM, felt more than heard. Purely rhythmic anchoring.

**`focus-long-session`** · 90 min — *Ninety minutes, unbroken.* The endurance
piece. Must not become tiring or noticeable across the full duration — vary
texture slowly enough that no change is ever perceptible in the moment. The
hardest asset in the catalogue to get right.

---

## 8. Audio the database does not know about

### 8.1 Background mixer loops (4 assets) — **required**

The player's mixer (`src/store/player.ts` → `BACKGROUND_SOUNDS`) offers an
ambient layer under any guided session. These are **not** rows in `sessions` and
have no `stream_url`; they need a delivery path and a small code change to point
at it. Suggested: `${CDN_BASE_URL}/ambience/{id}.m3u8`.

| id | Asset | Direction |
| --- | --- | --- |
| `rain` | Rain loop | Softer and thinner than `deep-rain` — this sits *under* a voice |
| `waves` | Waves loop | Long period, no gravel, no gulls |
| `forest` | Forest loop | Leaves and distant birds. **No sudden or close bird calls** |
| `noise` | White noise | Pink/brown weighted, not true white — true white is fatiguing |

Specification:
- **5–10 min, seamlessly loopable.** Test the loop point on headphones; a
  perceptible seam every five minutes is worse than no ambience.
- Mastered ~6 dB below the narration bed so the mix does not need ducking.
- Spectrally carved to leave 300 Hz – 3 kHz relatively clear for the voice.
- No events whatsoever — a single distinctive bird call becomes maddening on
  the fourth loop.

`none` is the default and needs no asset.

### 8.2 Interface cues (3 assets) — optional

The app is currently silent apart from haptics, which is a defensible choice for
a calm product. If added, keep them under 3 seconds and make them skippable:

- **Session complete** — a soft, resolving tone under the summary celebration.
- **Streak milestone** — a slightly brighter variant for 7/30/100-day badges.
- **Timer end** — for `focus_music`, which has no narrator to signal the end.

No notification or alert sounds. Reminders should use the system default.

---

## 9. Delivery, naming and manifest

The catalogue's URLs are generated in `apps/api/src/db/seed.ts` and are
**already stored in the database**. Producing files at these exact paths makes
the app play with no code change:

```
{CDN_BASE_URL}/hls/{slug}/master.m3u8     ← audio (the slug column in `sessions`)
{CDN_BASE_URL}/artwork/{slug}-{tint}.jpg  ← cover art
{CDN_BASE_URL}/ambience/{id}.m3u8         ← mixer loops (needs the code change in §8.1)
```

Set `CDN_BASE_URL` in `apps/api/.env`, re-run `pnpm db:seed`, and the stored URLs
update in place.

To regenerate the authoritative worklist at any point:

```sql
SELECT slug, title, format, category, duration_seconds/60 AS minutes,
       voice_pack, is_pro
  FROM sessions ORDER BY format, category, duration_seconds;
```

**Suggested production order**, by user impact per minute recorded:

1. The 10 Basics sessions (100 min) — the entire free tier.
2. The 4 background loops (~30 min) — used under everything else.
3. The 5 minis (9 min) — highest replay rate per minute produced.
4. Focus and sleep instrumentals (370 min) — no script, no casting, parallelisable.
5. The 33 remaining meditations (336 min).
6. Wind-downs (60 min), then movement (45 min).
7. The 6 sleepcasts (300 min) — most expensive per asset, most forgiving of delay
   since few users reach the end anyway.

---

## 10. Inconsistencies to resolve before recording

Real mismatches between the seeded metadata and the copy. Each needs a decision,
because the duration is what the UI displays and what the completion logic uses:

| Asset | Problem | Suggested fix |
| --- | --- | --- |
| `sixty-seconds` | Titled *Sixty Seconds*, subtitle "One minute, that is all", but seeded at **2 min** | Re-cut to 1 min — the title is the promise |
| `before-the-meeting` | Subtitle "A two-minute steadying", seeded at **3 min** | Change subtitle to three minutes, or re-cut to 2 |
| `traffic-light` | Fine at 2 min, but the *concept* implies use while driving | Keep the duration; add the driving-safety constraints in §6.9 to the script, and consider a subtitle that does not evoke driving |
| Sleepcast durations | 45/50/55 min | Consistent with the PRD glossary (45–60 min) — no change needed |
| Voice packs | Schema and Settings support three tones; catalogue supplies one per session | Decide §5 before recording — it is a 3× multiplier |

Durations live in the `duration_seconds` column and are set in
`apps/api/src/db/seed.ts`. Change them there and re-seed, so the metadata and
the delivered audio agree.
