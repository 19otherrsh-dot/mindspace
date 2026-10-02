/**
 * Seeds a realistic content library plus a demo account with history, so every
 * screen has something to render on first run. Idempotent: re-running updates
 * rows in place rather than duplicating them.
 *
 * Run with: pnpm db:seed
 */
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Category, ContentFormat, VoicePack } from '@mindspace/shared';
import { pool, transaction } from './pool.ts';
import { config } from '../config.ts';
import { addDays, localDate } from '../lib/dates.ts';
import { FREE_SESSION_LIMIT, TIMER_DURATIONS, unguidedSlug } from '@mindspace/shared';

/* ------------------------------------------------------------------ */
/* Source data                                                         */
/* ------------------------------------------------------------------ */

/**
 * Taglines exist because competitors lead with the narrator — Calm bills
 * "with Stephen Fry" above the title. A one-line credential does the same job
 * without celebrity licensing.
 */
const INSTRUCTORS = [
  {
    slug: 'nadia-okoye',
    name: 'Nadia Okoye',
    tagline: 'Former ER nurse',
    featured: true,
    bio: 'Former ER nurse turned mindfulness teacher. Nadia specialises in stress and burnout, and has guided over four million sessions.',
  },
  {
    slug: 'tom-hale',
    name: 'Tom Hale',
    tagline: 'Vipassana-trained, plainspoken',
    featured: true,
    bio: 'Tom trained in the Burmese Vipassana tradition and teaches a plainspoken, unfussy approach to daily practice.',
  },
  {
    slug: 'mira-castellanos',
    name: 'Mira Castellanos',
    tagline: 'Sleep researcher',
    featured: true,
    bio: 'A sleep researcher by training, Mira writes and narrates the Sleepcast series and the wind-down programs.',
  },
  {
    slug: 'jonas-berg',
    name: 'Jonas Berg',
    tagline: 'Performance coach',
    featured: false,
    bio: 'Jonas works with elite athletes on focus and performance, and brings that same attention to everyday concentration.',
  },
  {
    slug: 'priya-raman',
    name: 'Priya Raman',
    tagline: 'Clinical psychologist',
    featured: true,
    bio: 'Priya is a clinical psychologist whose work centres on anxiety, self-compassion and difficult relationships.',
  },
  {
    slug: 'sam-whitfield',
    name: 'Sam Whitfield',
    tagline: 'Movement teacher',
    featured: false,
    bio: 'Sam teaches mindful movement, blending gentle stretching with breath work for people who sit all day.',
  },
] as const;

type InstructorSlug = (typeof INSTRUCTORS)[number]['slug'];

interface SessionSeed {
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  category: Category;
  format: ContentFormat;
  minutes: number;
  voicePack: VoicePack | null;
  instructor: InstructorSlug | null;
  isPro: boolean;
  /** Rough popularity, used to seed play counts and ratings. */
  popularity: number;
}

const ARTWORK_TINTS: Record<Category, string> = {
  stress: '6C63FF',
  anxiety: '4FA3D1',
  sleep: '2E3192',
  focus: 'E8833A',
  relationships: 'D65DB1',
  sports: '2FA84F',
  beginners: '5B7FFF',
};

function artwork(slug: string, category: Category): string {
  // Deterministic placeholder art keyed to the category's tint.
  return `${config.cdnBaseUrl}/artwork/${slug}-${ARTWORK_TINTS[category]}.jpg`;
}

function stream(slug: string): string {
  return `${config.cdnBaseUrl}/hls/${slug}/master.m3u8`;
}

/** Builds the library from per-category templates rather than 500 literals. */
function buildSessions(): SessionSeed[] {
  const sessions: SessionSeed[] = [];

  const meditationTemplates: Array<{
    category: Category;
    instructor: InstructorSlug;
    voice: VoicePack;
    items: Array<[title: string, subtitle: string, description: string]>;
  }> = [
    {
      category: 'stress',
      instructor: 'nadia-okoye',
      voice: 'calm',
      items: [
        ['Letting the Day Go', 'Release the tension you carried home', 'A guided unwinding for the end of a demanding day. Nadia walks you through releasing the physical grip that stress leaves in the jaw, shoulders and hands.'],
        ['Breathing Room', 'Make space when everything feels close', 'When the day has stacked up, this session widens the gap between what happens and how you respond.'],
        ['The Pressure Valve', 'A reset for high-stakes days', 'A short practice designed for the moments before something difficult — a presentation, a conversation, a decision.'],
        ['Unclenching', 'Notice where you hold it', 'A body-led practice that finds the tension you have stopped noticing, and lets it go.'],
        ['After the Storm', 'Settling once the hard part is over', 'Stress does not end when the event does. This session helps the body catch up with the fact that you are safe.'],
      ],
    },
    {
      category: 'anxiety',
      instructor: 'priya-raman',
      voice: 'warm',
      items: [
        ['Ground Beneath You', 'Come back to the present', 'A grounding practice using the senses to interrupt anxious spirals and return attention to what is actually here.'],
        ['The Worry Loop', 'Step out of the circling thought', 'Priya offers a way to notice a worry loop without arguing with it, and to let it lose its grip.'],
        ['Steady Hands', 'For when the body races ahead', 'A breath-led session for the physical side of anxiety — the racing heart, the shallow breath, the restless hands.'],
        ['Nothing to Fix', 'Sitting with discomfort', 'Not every difficult feeling needs solving. This practice builds tolerance for sitting with what is uncomfortable.'],
        ['Kind to Yourself', 'Self-compassion when you are struggling', 'A gentle practice for the days you have been hardest on yourself.'],
        ['Before the Meeting', 'A two-minute steadying', 'Short enough to do in a stairwell, useful enough to change how you walk into the room.'],
      ],
    },
    {
      category: 'focus',
      instructor: 'jonas-berg',
      voice: 'neutral',
      items: [
        ['Single Point', 'Train sustained attention', 'A concentration practice that builds the muscle of returning — again and again — to one thing.'],
        ['Clearing the Desk', 'Start the work session properly', 'Five minutes that mark the boundary between everything else and the work in front of you.'],
        ['The Long Read', 'Deep focus for demanding work', 'A longer session for work that needs uninterrupted attention. Best paired with the focus soundscapes.'],
        ['Refocus', 'Recover from an interruption', 'Attention does not snap back on its own. This short reset rebuilds it after a break.'],
        ['Morning Sharpening', 'Set the tone before the inbox', 'A practice for the first minutes of the working day, before anything else claims them.'],
      ],
    },
    {
      category: 'sleep',
      instructor: 'mira-castellanos',
      voice: 'calm',
      items: [
        ['Falling Away', 'Let the day dissolve', 'A slow, descending practice that guides the body toward sleep without demanding it.'],
        ['The Long Exhale', 'Breathing yourself down', 'Extended exhalations shift the nervous system toward rest. Mira paces the breath for you.'],
        ['Nightly Reset', 'Close the day cleanly', 'A short review-and-release practice for people whose minds start working the moment the light goes off.'],
        ['Back to Sleep', 'For waking at 3am', 'Written for the middle of the night: no bright ideas, no instructions to remember, just a way back down.'],
      ],
    },
    {
      category: 'relationships',
      instructor: 'priya-raman',
      voice: 'warm',
      items: [
        ['Before the Conversation', 'Arrive able to listen', 'A preparation practice for a conversation you have been dreading.'],
        ['Letting Them Be Wrong', 'Loosening the need to win', 'A practice on holding your position without needing the other person to concede it.'],
        ['Repair', 'After you got it wrong', 'For the hours after an argument, when the impulse is either to defend or to disappear.'],
        ['Loving Kindness', 'Extending goodwill outward', 'The classic metta practice, taught plainly — beginning with yourself and widening from there.'],
      ],
    },
    {
      category: 'sports',
      instructor: 'jonas-berg',
      voice: 'neutral',
      items: [
        ['Pre-Race Calm', 'Settle the start line nerves', 'Turning pre-competition adrenaline into something usable rather than something to fight.'],
        ['In the Set', 'Focus between efforts', 'A short practice for the rest interval — recovering attention as well as breath.'],
        ['The Wall', 'When you want to stop', 'A practice for the point in an effort where the mind quits before the body does.'],
        ['After the Loss', 'Processing a bad result', 'A session for the hours after it did not go your way.'],
      ],
    },
    {
      category: 'beginners',
      instructor: 'tom-hale',
      voice: 'neutral',
      items: [
        ['What Meditation Actually Is', 'Start here', 'Tom clears away the mysticism and explains, plainly, what you are doing and why it works.'],
        ['Noticing the Breath', 'Your first practice', 'The foundational practice. No prior experience assumed, nothing to get right.'],
        ['When Your Mind Wanders', 'The part everyone gets wrong', 'Wandering is not failure — it is the practice. This session explains why.'],
        ['Sitting Comfortably', 'Posture without the fuss', 'Practical guidance on how to sit so your body is not the thing you are fighting.'],
        ['Making It a Habit', 'The hard part', 'Less about meditation than about how any daily practice actually sticks.'],
      ],
    },
  ];

  // Standard meditations, at the lengths from PRD §3.1.
  const lengths = [3, 5, 10, 15, 20];
  let lengthIndex = 0;

  for (const template of meditationTemplates) {
    for (const [title, subtitle, description] of template.items) {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      sessions.push({
        slug,
        title,
        subtitle,
        description,
        category: template.category,
        format: 'meditation',
        minutes: title === 'Before the Meeting' ? 2 : lengths[lengthIndex % lengths.length]!,
        voicePack: template.voice,
        instructor: template.instructor,
        isPro: true,
        popularity: 100 - sessions.length * 2,
      });
      lengthIndex += 1;
    }
  }

  // Sleepcasts — long-form ambient narratives (glossary, §9).
  const sleepcasts: Array<[string, string, string]> = [
    ['Rainforest Canopy', 'A night high in the trees', 'Rain moves through the canopy above you while the forest floor settles. Fifty minutes of slow narration that asks nothing of you.'],
    ['Harbour Town', 'Boats knocking gently at the dock', 'The tide comes in against the hulls, a lighthouse turns, and the town goes quiet one window at a time.'],
    ['The Cabin', 'Snow against the windows', 'A fire settling in the grate, snow accumulating on the roof, and nowhere at all you have to be.'],
    ['Night Train', 'Rolling through the dark', 'The rhythm of rail joints, the occasional station passing unlit, a carriage almost to yourself.'],
    ['Desert Sky', 'Cooling sand and open stars', 'Heat leaving the ground as the sky opens up. Slow, wide and empty in the best way.'],
    ['Lakeside', 'Water against a wooden jetty', 'Small waves, distant loons, and the particular stillness of a lake after dark.'],
  ];

  for (const [title, subtitle, description] of sleepcasts) {
    sessions.push({
      slug: `sleepcast-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title,
      subtitle,
      description,
      category: 'sleep',
      format: 'sleepcast',
      minutes: 45 + sessions.length % 3 * 5,
      voicePack: 'calm',
      instructor: 'mira-castellanos',
      isPro: true,
      popularity: 80 - sessions.length,
    });
  }

  // Ambient audio: no narrator, so no voice pack.
  const soundscapes: Array<[string, string, ContentFormat, Category, number]> = [
    ['Deep Rain', 'Steady rainfall, no thunder', 'sleep_music', 'sleep', 45],
    ['Ocean Shelf', 'Slow swell on a distant shore', 'sleep_music', 'sleep', 60],
    ['Binaural Drift', 'Low tones for deep sleep', 'sleep_music', 'sleep', 30],
    ['Night Wind', 'Air moving through open country', 'sleep_music', 'sleep', 45],
    ['Focus: Deep Work', 'Warm ambient pads, 25 minutes', 'focus_music', 'focus', 25],
    ['Focus: Flow State', 'Minimal pulse, no melody', 'focus_music', 'focus', 50],
    ['Focus: Library', 'Quiet room tone and soft texture', 'focus_music', 'focus', 25],
    ['Focus: Long Session', 'Ninety minutes, unbroken', 'focus_music', 'focus', 90],
  ];

  for (const [title, subtitle, format, category, minutes] of soundscapes) {
    sessions.push({
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      subtitle,
      description: `${subtitle}. Designed to sit underneath what you are doing rather than compete with it.`,
      category,
      format,
      minutes,
      voicePack: null,
      instructor: null,
      isPro: true,
      popularity: 70 - sessions.length,
    });
  }

  // Mini meditations — the 1–2 minute resets from §3.3.
  const minis: Array<[string, string, Category]> = [
    ['Sixty Seconds', 'One minute, that is all', 'stress'],
    ['Three Breaths', 'The shortest possible reset', 'anxiety'],
    ['Desk Reset', 'Without leaving your chair', 'focus'],
    ['Doorway Pause', 'Between one thing and the next', 'stress'],
    ['Traffic Light', 'A pause for stationary moments', 'stress'],
  ];

  for (const [title, subtitle, category] of minis) {
    sessions.push({
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      subtitle,
      description: `${subtitle}. A mini meditation for schedules that do not have a spare ten minutes in them.`,
      category,
      format: 'mini',
      minutes: (title === 'Sixty Seconds' || title === 'Three Breaths') ? 1 : 2,
      voicePack: 'warm',
      instructor: 'nadia-okoye',
      isPro: true,
      popularity: 90 - sessions.length,
    });
  }

  // Mindful movement (§3.3).
  const movement: Array<[string, string, number]> = [
    ['Neck and Shoulders', 'For screen-shaped posture', 8],
    ['Standing Stretch', 'Away from the desk', 10],
    ['Morning Mobility', 'Wake the body up first', 12],
    ['Wind-Down Stretch', 'Slow movement before bed', 15],
  ];

  for (const [title, subtitle, minutes] of movement) {
    sessions.push({
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      subtitle,
      description: `${subtitle}. Gentle stretching paced with the breath — no equipment, no floor space required.`,
      category: 'stress',
      format: 'movement',
      minutes,
      voicePack: 'neutral',
      instructor: 'sam-whitfield',
      isPro: true,
      popularity: 55,
    });
  }

  // Wind-down routines (§3.2) — the 20-minute pre-sleep sequences.
  const windDowns: Array<[string, string]> = [
    ['Wind-Down: Standard', 'Movement, breath, then stillness'],
    ['Wind-Down: Screens Off', 'For late-night workers'],
    ['Wind-Down: Restless', 'When you are tired but wired'],
  ];

  for (const [title, subtitle] of windDowns) {
    sessions.push({
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      subtitle,
      description: `${subtitle}. A twenty-minute sequence combining light movement, breathing and a short meditation.`,
      category: 'sleep',
      format: 'wind_down',
      minutes: 20,
      voicePack: 'calm',
      instructor: 'mira-castellanos',
      isPro: true,
      popularity: 60,
    });
  }

  return sessions;
}

/**
 * One session per timer length, backing the unguided timer.
 *
 * These are not library content — they are excluded from browse and search —
 * but modelling them as real sessions means a timed sit flows through exactly
 * the same completion, streak, history and achievement code as a guided one.
 * They are free on every tier: a plain timer behind a paywall is hostile, and
 * competitors give it away.
 */
function buildUnguidedSessions(): SessionSeed[] {
  return TIMER_DURATIONS.map((minutes) => ({
    slug: unguidedSlug(minutes),
    title: `${minutes} minute timer`,
    subtitle: 'Unguided',
    description:
      'A silent sit with a bell to begin and end, and optional interval bells along the way. No narration — just the time you set aside.',
    category: 'beginners' as Category,
    format: 'unguided' as ContentFormat,
    minutes,
    voicePack: null,
    instructor: null,
    isPro: false,
    popularity: 40,
  }));
}

/** The 10-day Basics course, which is free on every tier (PRD §6). */
function buildBasicsSessions(): SessionSeed[] {
  const days: Array<[string, string]> = [
    ['Getting Started', 'What you are actually doing when you meditate, and why it is worth ten minutes.'],
    ['The Breath', 'Using the breath as an anchor — the simplest and most reliable object of attention.'],
    ['Wandering', 'Your mind will wander. Today is about what to do when it does.'],
    ['The Body Scan', 'Moving attention deliberately through the body, from the feet upward.'],
    ['Noting', 'Naming what shows up — thinking, hearing, feeling — and letting it pass.'],
    ['Difficult Feelings', 'What to do when the practice brings up something uncomfortable.'],
    ['Off the Cushion', 'Carrying the attention you have built into ordinary activity.'],
    ['Patience', 'Progress is not linear. Today addresses the plateau most people hit here.'],
    ['Kindness', 'Introducing self-compassion into the practice.'],
    ['Keeping Going', 'How to make this a habit rather than a fortnight.'],
  ];

  return days.map(([title, description], index) => ({
    slug: `basics-day-${index + 1}`,
    title: `Day ${index + 1}: ${title}`,
    subtitle: 'Basics',
    description,
    category: 'beginners' as Category,
    format: 'meditation' as ContentFormat,
    minutes: 10,
    voicePack: 'neutral' as VoicePack,
    instructor: 'tom-hale' as InstructorSlug,
    // The Basics course is the free tier's headline content.
    isPro: false,
    popularity: 200 - index,
  }));
}

const COURSES = [
  {
    slug: 'basics',
    title: 'Basics',
    description:
      'Ten days to build a practice that lasts. Tom Hale starts from the assumption that you have never done this before and works up from there. This is the right first course for almost everyone.',
    instructor: 'tom-hale' as InstructorSlug,
    accentColor: '#5B7FFF',
    isPro: false,
    isFeatured: true,
    sessionSlugs: Array.from({ length: 10 }, (_, i) => `basics-day-${i + 1}`),
    dayTitles: [
      'Getting Started', 'The Breath', 'Wandering', 'The Body Scan', 'Noting',
      'Difficult Feelings', 'Off the Cushion', 'Patience', 'Kindness', 'Keeping Going',
    ],
  },
  {
    slug: 'managing-stress',
    title: 'Managing Stress',
    description:
      'A fourteen-day program for people whose stress has stopped being occasional. Nadia Okoye draws on her years in emergency medicine to teach recovery that works under real pressure.',
    instructor: 'nadia-okoye' as InstructorSlug,
    accentColor: '#6C63FF',
    isPro: true,
    isFeatured: true,
    sessionSlugs: [
      'letting-the-day-go', 'breathing-room', 'the-pressure-valve', 'unclenching',
      'after-the-storm', 'sixty-seconds', 'doorway-pause', 'neck-and-shoulders',
      'standing-stretch', 'traffic-light', 'ground-beneath-you', 'steady-hands',
      'nothing-to-fix', 'kind-to-yourself',
    ],
    dayTitles: [
      'Recognising the Load', 'Making Space', 'Under Pressure', 'Where You Hold It',
      'The Aftermath', 'Micro-Recovery', 'Between Tasks', 'The Physical Toll',
      'Moving Through It', 'Found Moments', 'Getting Grounded', 'Steadying',
      'Sitting With It', 'Being Kind',
    ],
  },
  {
    slug: 'building-confidence',
    title: 'Building Confidence',
    description:
      'Confidence is not a feeling you wait for. Over ten days, Priya Raman works on the self-talk underneath it — the running commentary that decides what you think you are capable of.',
    instructor: 'priya-raman' as InstructorSlug,
    accentColor: '#D65DB1',
    isPro: true,
    isFeatured: false,
    sessionSlugs: [
      'kind-to-yourself', 'nothing-to-fix', 'the-worry-loop', 'before-the-meeting',
      'ground-beneath-you', 'letting-them-be-wrong', 'before-the-conversation',
      'loving-kindness', 'repair', 'steady-hands',
    ],
    dayTitles: [
      'The Inner Critic', 'Without Fixing', 'Circling Thoughts', 'Walking In',
      'Standing Your Ground', 'Not Needing to Win', 'Difficult Conversations',
      'Goodwill', 'Getting It Wrong', 'Steady',
    ],
  },
  {
    slug: 'sleep-better',
    title: 'Sleep Better',
    description:
      'Mira Castellanos spent a decade in sleep research before she started teaching. This seven-day course is about what actually moves the needle, and what does not.',
    instructor: 'mira-castellanos' as InstructorSlug,
    accentColor: '#2E3192',
    isPro: true,
    isFeatured: false,
    sessionSlugs: [
      'wind-down-standard', 'falling-away', 'the-long-exhale', 'nightly-reset',
      'back-to-sleep', 'wind-down-restless', 'wind-down-screens-off',
    ],
    dayTitles: [
      'The Routine', 'Letting Go', 'Breathing Down', 'Closing the Day',
      'The 3am Problem', 'Tired but Wired', 'Making It Stick',
    ],
  },
] as const;

/**
 * Licensed therapists. Availability is stored in each clinician's own
 * timezone, and licences are per jurisdiction — a client outside those
 * jurisdictions cannot book them, which the booking endpoint enforces.
 */
const THERAPISTS = [
  {
    slug: 'dana-alvarez',
    fullName: 'Dr Dana Alvarez',
    credentials: 'PsyD, Clinical Psychologist',
    headline: 'Anxiety, burnout and the pressure of high-stakes work',
    bio: 'Dana spent eight years in hospital psychiatry before moving to private practice. She works mostly with people whose anxiety shows up as overwork, and her approach is practical rather than exploratory — you will leave the first session with something to try.',
    timezone: 'America/New_York',
    languages: ['en', 'es'],
    specialties: ['anxiety', 'burnout', 'stress'],
    priceCents: 16000,
    currency: 'USD',
    sessionMinutes: 50,
    minNoticeHours: 24,
    licences: [
      { jurisdiction: 'US-NY', body: 'NY Office of the Professions', number: 'PSY-019284' },
      { jurisdiction: 'US-CA', body: 'CA Board of Psychology', number: 'PSY-77120' },
    ],
    // Weekday (0 = Sunday), start, end — in the therapist's own timezone.
    availability: [
      [1, '09:00', '13:00'],
      [2, '09:00', '13:00'],
      [3, '13:00', '18:00'],
      [4, '09:00', '13:00'],
    ] as Array<[number, string, string]>,
  },
  {
    slug: 'marcus-obi',
    fullName: 'Marcus Obi',
    credentials: 'LCSW, Psychotherapist',
    headline: 'Grief, life transitions and men who have never done this before',
    bio: 'Marcus works with people going through the endings nobody plans for — bereavement, divorce, redundancy. A lot of his clients have never seen a therapist and are not sure they should be. He is unhurried and hard to shock.',
    timezone: 'Europe/London',
    languages: ['en'],
    specialties: ['grief', 'transitions', 'relationships'],
    priceCents: 9000,
    currency: 'GBP',
    sessionMinutes: 50,
    minNoticeHours: 12,
    licences: [{ jurisdiction: 'GB', body: 'BACP', number: 'BACP-338291' }],
    availability: [
      [1, '17:00', '21:00'],
      [3, '17:00', '21:00'],
      [6, '10:00', '15:00'],
    ] as Array<[number, string, string]>,
  },
  {
    slug: 'priya-nair',
    fullName: 'Dr Priya Nair',
    credentials: 'MD, Psychiatrist',
    headline: 'Sleep disorders and the anxiety that keeps you awake',
    bio: 'Priya is a psychiatrist specialising in sleep. She sees the full loop — the anxiety that wrecks your sleep and the exhaustion that worsens the anxiety — and can advise on medication where it is genuinely warranted.',
    timezone: 'Asia/Kolkata',
    languages: ['en', 'hi', 'ml'],
    specialties: ['sleep', 'anxiety'],
    priceCents: 450000,
    currency: 'INR',
    sessionMinutes: 45,
    minNoticeHours: 24,
    licences: [{ jurisdiction: 'IN', body: 'National Medical Commission', number: 'NMC-55401' }],
    availability: [
      [1, '10:00', '14:00'],
      [2, '10:00', '14:00'],
      [4, '15:00', '19:00'],
      [5, '10:00', '14:00'],
    ] as Array<[number, string, string]>,
  },
  {
    slug: 'ellen-hartley',
    fullName: 'Ellen Hartley',
    credentials: 'MA, Counselling Psychologist',
    headline: 'Trauma-informed work at whatever pace you need',
    bio: 'Ellen works with complex trauma and PTSD. She is explicit that this work goes at the client\'s pace and that going slowly is not a failure — a lot of her clients arrive having been rushed somewhere else.',
    timezone: 'America/Los_Angeles',
    languages: ['en'],
    specialties: ['trauma', 'ptsd', 'anxiety'],
    priceCents: 18000,
    currency: 'USD',
    sessionMinutes: 50,
    minNoticeHours: 48,
    licences: [{ jurisdiction: 'US-CA', body: 'CA Board of Behavioral Sciences', number: 'LPCC-8823' }],
    availability: [
      [2, '08:00', '12:00'],
      [3, '08:00', '12:00'],
      [4, '12:00', '17:00'],
    ] as Array<[number, string, string]>,
  },
] as const;

const ACHIEVEMENTS = [
  { slug: 'first-session', title: 'First Steps', description: 'Complete your first session', icon: 'sprout', metric: 'total_sessions', threshold: 1 },
  { slug: 'ten-sessions', title: 'Getting Going', description: 'Complete 10 sessions', icon: 'leaf', metric: 'total_sessions', threshold: 10 },
  { slug: 'fifty-sessions', title: 'Established', description: 'Complete 50 sessions', icon: 'tree', metric: 'total_sessions', threshold: 50 },
  { slug: 'hundred-sessions', title: 'Centurion', description: 'Complete 100 sessions', icon: 'mountain', metric: 'total_sessions', threshold: 100 },
  { slug: 'streak-3', title: 'Three in a Row', description: 'Meditate 3 days running', icon: 'flame', metric: 'streak', threshold: 3 },
  { slug: 'streak-7', title: 'A Full Week', description: 'Meditate 7 days running', icon: 'flame', metric: 'streak', threshold: 7 },
  { slug: 'streak-30', title: 'A Month of Practice', description: 'Meditate 30 days running', icon: 'flame', metric: 'streak', threshold: 30 },
  { slug: 'streak-100', title: 'One Hundred Days', description: 'Meditate 100 days running', icon: 'crown', metric: 'streak', threshold: 100 },
  { slug: 'minutes-60', title: 'First Hour', description: 'Meditate for 60 minutes in total', icon: 'clock', metric: 'total_minutes', threshold: 60 },
  { slug: 'minutes-500', title: 'Deep Practice', description: 'Meditate for 500 minutes in total', icon: 'hourglass', metric: 'total_minutes', threshold: 500 },
  { slug: 'minutes-1000', title: 'A Thousand Minutes', description: 'Meditate for 1,000 minutes in total', icon: 'star', metric: 'total_minutes', threshold: 1000 },
  { slug: 'course-1', title: 'Course Complete', description: 'Finish your first course', icon: 'medal', metric: 'courses_completed', threshold: 1 },
  { slug: 'course-5', title: 'Student', description: 'Finish 5 courses', icon: 'trophy', metric: 'courses_completed', threshold: 5 },
] as const;

const COLLECTIONS = [
  { slug: 'sleep-sounds', title: 'Sleep Sounds', description: 'Sleepcasts and soundscapes for drifting off. Long, slow and going nowhere.', category: 'sleep' as Category, accent: '#2E3192', featured: true, formats: ['sleepcast', 'sleep_music'] as ContentFormat[] },
  { slug: 'anxiety-relief', title: 'Anxiety Relief', description: 'Practices for the spiralling thought and the racing body, from Priya Raman.', category: 'anxiety' as Category, accent: '#4FA3D1', featured: true, formats: null },
  { slug: 'start-here', title: 'Start Here', description: 'Never meditated before? These are the sessions to open first.', category: 'beginners' as Category, accent: '#5B7FFF', featured: true, formats: null },
  { slug: 'deep-focus', title: 'Deep Focus', description: 'Concentration practices and ambient tracks for work that needs your full attention.', category: 'focus' as Category, accent: '#E8833A', featured: false, formats: null },
  { slug: 'quick-resets', title: 'Quick Resets', description: 'One and two-minute practices for days with no gaps in them.', category: null, accent: '#2FA84F', featured: true, formats: ['mini'] as ContentFormat[] },
  { slug: 'move-and-breathe', title: 'Move & Breathe', description: 'Mindful movement for bodies that have been sitting too long.', category: null, accent: '#D65DB1', featured: false, formats: ['movement'] as ContentFormat[] },
] as const;

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

async function seed(): Promise<void> {
  const allSessions = [
    ...buildBasicsSessions(),
    ...buildSessions(),
    ...buildUnguidedSessions(),
  ];

  // PRD §6 gives the free tier 10 guided sessions. The Basics course supplies
  // exactly that many, so everything else guided stays Pro. Timers are counted
  // separately — a silent timer is a tool, not part of the content allowance.
  const freeGuided = allSessions.filter((s) => !s.isPro && s.format !== 'unguided');
  if (freeGuided.length !== FREE_SESSION_LIMIT) {
    throw new Error(
      `Seed defines ${freeGuided.length} free guided sessions but the free tier allows ${FREE_SESSION_LIMIT}`,
    );
  }
  const freeCount = freeGuided.length;

  await transaction(async (client) => {
    /* Instructors */
    const instructorIds = new Map<string, string>();
    for (const person of INSTRUCTORS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO instructors (slug, name, bio, avatar_url, tagline, is_featured, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, bio = EXCLUDED.bio,
           tagline = EXCLUDED.tagline, is_featured = EXCLUDED.is_featured
         RETURNING id`,
        [
          person.slug,
          person.name,
          person.bio,
          `${config.cdnBaseUrl}/instructors/${person.slug}.jpg`,
          person.tagline,
          person.featured,
          INSTRUCTORS.indexOf(person),
        ],
      );
      instructorIds.set(person.slug, rows[0]!.id);
    }
    console.log(`[seed] ${instructorIds.size} instructors`);

    /* Sessions */
    const sessionIds = new Map<string, string>();
    for (const [index, s] of allSessions.entries()) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO sessions
           (slug, title, subtitle, description, category, format, duration_seconds,
            voice_pack, instructor_id, artwork_url, stream_url, is_pro, play_count, published_at)
         VALUES ($1, $2, $3, $4, $5::content_category, $6::content_format, $7,
                 $8::voice_pack, $9::uuid, $10, $11, $12, $13,
                 now() - make_interval(days => $14::int))
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
           description = EXCLUDED.description, duration_seconds = EXCLUDED.duration_seconds,
           is_pro = EXCLUDED.is_pro
         RETURNING id`,
        [
          s.slug,
          s.title,
          s.subtitle,
          s.description,
          s.category,
          s.format,
          s.minutes * 60,
          s.voicePack,
          s.instructor ? instructorIds.get(s.instructor) : null,
          artwork(s.slug, s.category),
          stream(s.slug),
          s.isPro,
          Math.max(s.popularity, 5) * 137,
          // Spread publish dates so "Trending this week" and "New" differ.
          index * 3,
        ],
      );
      sessionIds.set(s.slug, rows[0]!.id);
    }
    console.log(`[seed] ${sessionIds.size} sessions (${freeCount} free)`);

    /* Collections */
    for (const [index, collection] of COLLECTIONS.entries()) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO collections
           (slug, title, description, hero_artwork_url, accent_color, category, is_featured, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6::content_category, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description,
           is_featured = EXCLUDED.is_featured
         RETURNING id`,
        [
          collection.slug,
          collection.title,
          collection.description,
          `${config.cdnBaseUrl}/collections/${collection.slug}.jpg`,
          collection.accent,
          collection.category,
          collection.featured,
          index,
        ],
      );

      const collectionId = rows[0]!.id;
      const members = allSessions.filter((s) => {
        // Timers are a tool, not curated content — keep them out of collections.
        if (s.format === 'unguided') return false;
        if (collection.formats) return collection.formats.includes(s.format);
        return s.category === collection.category;
      });

      await client.query('DELETE FROM collection_sessions WHERE collection_id = $1::uuid', [
        collectionId,
      ]);

      for (const [position, member] of members.entries()) {
        await client.query(
          `INSERT INTO collection_sessions (collection_id, session_id, position)
           VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING`,
          [collectionId, sessionIds.get(member.slug), position],
        );
      }
    }
    console.log(`[seed] ${COLLECTIONS.length} collections`);

    /* Courses */
    for (const course of COURSES) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO courses
           (slug, title, description, artwork_url, accent_color, instructor_id,
            total_days, is_pro, is_featured, rating_sum, rating_count)
         VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description,
           total_days = EXCLUDED.total_days, is_pro = EXCLUDED.is_pro
         RETURNING id`,
        [
          course.slug,
          course.title,
          course.description,
          `${config.cdnBaseUrl}/courses/${course.slug}.jpg`,
          course.accentColor,
          instructorIds.get(course.instructor),
          course.sessionSlugs.length,
          course.isPro,
          course.isFeatured,
          // A plausible 4.7-ish average out of a few thousand ratings.
          Math.round(4.7 * 2400),
          2400,
        ],
      );

      const courseId = rows[0]!.id;
      await client.query('DELETE FROM course_days WHERE course_id = $1::uuid', [courseId]);

      for (const [index, slug] of course.sessionSlugs.entries()) {
        const sessionId = sessionIds.get(slug);
        if (!sessionId) throw new Error(`Course ${course.slug} references unknown session "${slug}"`);

        await client.query(
          `INSERT INTO course_days (course_id, day_number, title, session_id)
           VALUES ($1::uuid, $2, $3, $4::uuid)`,
          [courseId, index + 1, course.dayTitles[index] ?? `Day ${index + 1}`, sessionId],
        );
      }
    }
    console.log(`[seed] ${COURSES.length} courses`);

    /* Achievements */
    for (const [index, achievement] of ACHIEVEMENTS.entries()) {
      await client.query(
        `INSERT INTO achievements (slug, title, description, icon, metric, threshold, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description,
           threshold = EXCLUDED.threshold`,
        [
          achievement.slug,
          achievement.title,
          achievement.description,
          achievement.icon,
          achievement.metric,
          achievement.threshold,
          index,
        ],
      );
    }
    console.log(`[seed] ${ACHIEVEMENTS.length} achievements`);

    /* Therapists */
    for (const person of THERAPISTS) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO therapists
           (slug, full_name, credentials, headline, bio, avatar_url, timezone,
            languages, specialties, session_price_cents, currency, session_minutes,
            min_notice_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10, $11, $12, $13)
         ON CONFLICT (slug) DO UPDATE SET
           full_name = EXCLUDED.full_name, headline = EXCLUDED.headline,
           bio = EXCLUDED.bio, session_price_cents = EXCLUDED.session_price_cents
         RETURNING id`,
        [
          person.slug,
          person.fullName,
          person.credentials,
          person.headline,
          person.bio,
          `${config.cdnBaseUrl}/therapists/${person.slug}.jpg`,
          person.timezone,
          person.languages,
          person.specialties,
          person.priceCents,
          person.currency,
          person.sessionMinutes,
          person.minNoticeHours,
        ],
      );

      const therapistId = rows[0]!.id;

      for (const licence of person.licences) {
        await client.query(
          `INSERT INTO therapist_licences (therapist_id, jurisdiction, licence_body, licence_number)
           VALUES ($1::uuid, $2, $3, $4)
           ON CONFLICT (therapist_id, jurisdiction, licence_number) DO NOTHING`,
          [therapistId, licence.jurisdiction, licence.body, licence.number],
        );
      }

      // Rebuild availability so re-seeding does not stack duplicate windows.
      await client.query('DELETE FROM therapist_availability WHERE therapist_id = $1::uuid', [
        therapistId,
      ]);
      for (const [weekday, start, end] of person.availability) {
        await client.query(
          `INSERT INTO therapist_availability (therapist_id, weekday, start_time, end_time)
           VALUES ($1::uuid, $2, $3::time, $4::time)`,
          [therapistId, weekday, start, end],
        );
      }
    }
    console.log(`[seed] ${THERAPISTS.length} therapists`);

    /* Demo account with history, so Home and Stats are not empty on first run */
    const demoEmail = 'demo@mindspace.app';
    const { rows: demoRows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, timezone, subscription_tier)
       VALUES ($1, $2, $3, $4, 'pro_annual')
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [demoEmail, await bcrypt.hash('mindspace', 12), 'Ada', 'Europe/London'],
    );
    const demoId = demoRows[0]!.id;

    await client.query(
      'INSERT INTO user_preferences (user_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING',
      [demoId],
    );

    await client.query(
      `INSERT INTO onboarding_profiles
         (user_id, goals, experience_level, sleep_quality, daily_minutes, preferred_time)
       VALUES ($1::uuid, '{stress,sleep}'::content_category[], 'some', 'fair', 10, 'morning')
       ON CONFLICT (user_id) DO NOTHING`,
      [demoId],
    );

    // Rebuild history from scratch so re-seeding does not stack duplicates.
    await client.query('DELETE FROM session_completions WHERE user_id = $1::uuid', [demoId]);
    await client.query('DELETE FROM mood_entries WHERE user_id = $1::uuid', [demoId]);

    const today = localDate('Europe/London');
    const historySlugs = allSessions.filter((s) => s.format === 'meditation').map((s) => s.slug);

    // 40 days of history with a couple of deliberate gaps, so the heatmap and
    // the streak logic both have something interesting to show.
    let written = 0;
    for (let daysAgo = 45; daysAgo >= 0; daysAgo -= 1) {
      if (daysAgo === 12 || daysAgo === 13 || daysAgo === 27) continue; // missed days
      const date = addDays(today, -daysAgo);
      const slug = historySlugs[written % historySlugs.length]!;
      const session = allSessions.find((s) => s.slug === slug)!;

      await client.query(
        // make_interval keeps $4 numeric; concatenating it into a string would
        // make Postgres infer the parameter as text and reject the int column.
        `INSERT INTO session_completions
           (user_id, session_id, started_at, completed_at, seconds_listened, finished, activity_date)
         VALUES ($1::uuid, $2::uuid,
                 $3::date + time '07:30',
                 $3::date + time '07:30' + make_interval(secs => $4::int),
                 $4::int, TRUE, $3::date)`,
        [demoId, sessionIds.get(slug), date, session.minutes * 60],
      );

      // Leave a couple of recent sessions unfinished so the Home feed's
      // "Continue where you left off" row has something to show.
      if (daysAgo === 2 || daysAgo === 5) {
        const partialSlug = historySlugs[(written + 7) % historySlugs.length]!;
        const partial = allSessions.find((s) => s.slug === partialSlug)!;
        await client.query(
          `INSERT INTO session_completions
             (user_id, session_id, started_at, completed_at, seconds_listened, finished, activity_date)
           VALUES ($1::uuid, $2::uuid,
                   $3::date + time '21:10',
                   $3::date + time '21:10' + make_interval(secs => $4::int),
                   $4::int, FALSE, $3::date)`,
          [demoId, sessionIds.get(partialSlug), date, Math.round(partial.minutes * 60 * 0.4)],
        );
      }

      // A mood check-in on most days, trending gently upward over time.
      if (written % 3 !== 2) {
        const value = Math.min(5, Math.max(1, 2 + Math.round((45 - daysAgo) / 15)));
        await client.query(
          `INSERT INTO mood_entries (user_id, value, context, activity_date, recorded_at)
           VALUES ($1::uuid, $2, 'post_session', $3::date, $3::date + time '07:45')`,
          [demoId, value, date],
        );
      }
      written += 1;
    }

    // Part-way through Basics, so the Home "continue" card has something to show.
    const { rows: basicsRows } = await client.query<{ id: string }>(
      "SELECT id FROM courses WHERE slug = 'basics'",
    );
    await client.query(
      `INSERT INTO course_enrollments (user_id, course_id, days_completed)
       VALUES ($1::uuid, $2::uuid, 4)
       ON CONFLICT (user_id, course_id) DO UPDATE SET days_completed = 4`,
      [demoId, basicsRows[0]!.id],
    );

    // Achievements are normally granted by POST /activity/complete. This
    // history was written straight to the table, so grant them here too —
    // otherwise the demo account shows 43 sessions against zero badges.
    await client.query(
      // Badges are never revoked once earned, so the streak metric is measured
      // against the longest run in the history, not the run standing today.
      `WITH days AS (
         SELECT DISTINCT activity_date AS d
           FROM session_completions WHERE user_id = $1::uuid
       ),
       islands AS (
         -- Consecutive dates share a constant (date - row_number).
         SELECT d - (row_number() OVER (ORDER BY d))::int AS grp FROM days
       ),
       longest AS (
         SELECT coalesce(max(len), 0)::int AS value
           FROM (SELECT count(*) AS len FROM islands GROUP BY grp) runs
       )
       INSERT INTO user_achievements (user_id, achievement_id)
       SELECT $1::uuid, a.id
         FROM achievements a
        WHERE CASE a.metric
                WHEN 'streak'            THEN (SELECT value FROM longest)
                WHEN 'total_sessions'    THEN (
                  SELECT count(*)::int FROM session_completions WHERE user_id = $1::uuid
                )
                WHEN 'total_minutes'     THEN (
                  SELECT coalesce(round(sum(seconds_listened) / 60.0), 0)::int
                    FROM session_completions WHERE user_id = $1::uuid
                )
                WHEN 'courses_completed' THEN 0
              END >= a.threshold
       ON CONFLICT DO NOTHING`,
      [demoId],
    );

    console.log(`[seed] demo account ${demoEmail} / mindspace — ${written} days of history`);
  });
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  seed()
    .then(() => pool.end())
    .then(() => {
      console.log('[seed] done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] failed:', err);
      process.exit(1);
    });
}

export { seed };
