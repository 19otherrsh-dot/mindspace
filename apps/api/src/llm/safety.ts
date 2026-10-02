/**
 * Crisis detection and escalation for the AI companion.
 *
 * The governing principle: **a language model is never the last line of
 * defence for someone in danger.** When a message trips a crisis rule the
 * model is bypassed entirely and a human-written response with real helpline
 * numbers is returned instead. That response is deterministic, reviewed, and
 * cannot hallucinate a phone number.
 *
 * Consequences of that principle, all deliberate:
 *  - Crisis handling is never behind the paywall or a rate limit.
 *  - The classifier is intentionally over-sensitive. A false positive shows
 *    someone a helpline they did not need; a false negative is the failure
 *    that actually matters.
 *  - Model output is screened on the way out too, so a model that invents a
 *    helpline number cannot deliver it to a user.
 */

export type RiskLevel = 'none' | 'elevated' | 'crisis';

export interface RiskAssessment {
  level: RiskLevel;
  /** Rule that fired. Logged for safety review; never the message text. */
  category: string | null;
}

/**
 * Crisis patterns. Written against the phrasings people actually use rather
 * than clinical vocabulary, and matched on a normalised copy of the message
 * so spacing and punctuation cannot slip past them.
 */
const CRISIS_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  {
    category: 'suicidal_intent',
    pattern:
      /\b(kill myself|killing myself|end my life|ending my life|take my own life|want to die|wanna die|better off dead|not want to be alive|don'?t want to (be alive|live|exist)|suicidal|suicide)\b/,
  },
  {
    category: 'suicide_plan',
    pattern: /\b(how (to|do i) (kill|end)|overdose on|hang myself|jump off|shoot myself)\b/,
  },
  {
    category: 'self_harm',
    pattern:
      /\b(hurt myself|harm myself|self[- ]harm|self[- ]harming|cut myself|cutting myself|burn myself)\b/,
  },
  {
    category: 'harm_to_others',
    pattern: /\b(kill (him|her|them|someone|people)|hurt (someone|somebody|him|her|them))\b/,
  },
  {
    category: 'abuse',
    pattern:
      /\b(being abused|he hits me|she hits me|they hit me|beats me|sexually assaulted|raped me|domestic violence)\b/,
  },
  {
    category: 'medical_emergency',
    pattern: /\b(overdosed|took too many pills|can'?t breathe|chest pain|bleeding a lot)\b/,
  },
];

/**
 * Elevated — not a crisis, but the companion should be gentler and should
 * offer a route to a human. These only change tone; they never bypass the model.
 */
const ELEVATED_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: 'hopelessness', pattern: /\b(hopeless|no point|give up on everything|can'?t go on|worthless)\b/ },
  { category: 'panic', pattern: /\b(panic attack|panicking|can'?t stop shaking|hyperventilating)\b/ },
  { category: 'severe_distress', pattern: /\b(breaking down|falling apart|can'?t cope|losing control)\b/ },
  { category: 'substance', pattern: /\b(drinking too much|relapsed|using again|can'?t stop drinking)\b/ },
];

/**
 * Normalises the message so trivial obfuscation does not defeat matching:
 * lowercase, collapse repeated characters, strip punctuation between letters.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    // "k i l l" and "k.i.l.l" both collapse to "kill".
    .replace(/(?<=\b\w)[\s.\-_*]+(?=\w\b)/g, '')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every space removed, for a second matching pass.
 *
 * `normalise` collapses the separators inside a letter-spaced word, but when
 * *both* words are spaced out — "k i l l  m y s e l f" — it also swallows the
 * gap between them and produces "killmyself", which a pattern written with a
 * literal space cannot match. Comparing a despaced message against despaced
 * patterns catches that, and every other spacing trick with it.
 */
function despace(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * The same patterns with word gaps and boundaries removed, for matching
 * against `despace()`d text. Derived from the originals rather than written
 * out again, so the two lists cannot drift apart.
 */
function despacedVariant(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source
      // \b cannot hold once the surrounding whitespace is gone.
      .replace(/\\b/g, '')
      // Literal spaces between words disappear; the class [- ] keeps its dash.
      .replace(/(?<!\[[^\]]*) /g, ''),
    pattern.flags,
  );
}

const CRISIS_PATTERNS_DESPACED = CRISIS_PATTERNS.map((entry) => ({
  category: entry.category,
  pattern: despacedVariant(entry.pattern),
}));

const ELEVATED_PATTERNS_DESPACED = ELEVATED_PATTERNS.map((entry) => ({
  category: entry.category,
  pattern: despacedVariant(entry.pattern),
}));

/** Classifies an inbound user message. Cheap, synchronous, no network. */
export function assessRisk(message: string): RiskAssessment {
  const text = normalise(message);
  const flat = despace(text);

  /*
   * Crisis is checked in both forms before elevated is considered at all.
   * Erring toward the helpline is the only acceptable direction for this
   * classifier to be wrong in.
   */
  for (const { category, pattern } of CRISIS_PATTERNS) {
    if (pattern.test(text)) return { level: 'crisis', category };
  }
  for (const { category, pattern } of CRISIS_PATTERNS_DESPACED) {
    if (pattern.test(flat)) return { level: 'crisis', category };
  }

  for (const { category, pattern } of ELEVATED_PATTERNS) {
    if (pattern.test(text)) return { level: 'elevated', category };
  }
  for (const { category, pattern } of ELEVATED_PATTERNS_DESPACED) {
    if (pattern.test(flat)) return { level: 'elevated', category };
  }

  return { level: 'none', category: null };
}

export interface CrisisResource {
  region: string;
  name: string;
  contact: string;
  detail: string;
  url?: string;
}

/**
 * Helplines shown on a crisis classification.
 *
 * Hard-coded rather than model-generated: a hallucinated crisis number is
 * among the worst failures this product could produce. Operators deploying to
 * other regions should extend this list, and the `international` entry is
 * always included as a fallback.
 */
export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    region: 'US',
    name: '988 Suicide & Crisis Lifeline',
    contact: '988',
    detail: 'Call or text 988, 24 hours a day.',
    url: 'https://988lifeline.org',
  },
  {
    region: 'GB',
    name: 'Samaritans',
    contact: '116 123',
    detail: 'Free to call, 24 hours a day, from any phone in the UK and Ireland.',
    url: 'https://www.samaritans.org',
  },
  {
    region: 'IN',
    name: 'Tele-MANAS',
    contact: '14416',
    detail: "India's national mental health helpline, 24 hours a day.",
    url: 'https://telemanas.mohfw.gov.in',
  },
  {
    region: 'international',
    name: 'Find a Helpline',
    contact: 'findahelpline.com',
    detail: 'Free, confidential support lines in over 130 countries.',
    url: 'https://findahelpline.com',
  },
];

/** Region-relevant resources first, with the international fallback always last. */
export function resourcesFor(regionHint: string | null): CrisisResource[] {
  const region = (regionHint ?? '').toUpperCase();
  const local = CRISIS_RESOURCES.filter((r) => r.region !== 'international' && region.startsWith(r.region));
  const international = CRISIS_RESOURCES.filter((r) => r.region === 'international');
  return [...local, ...international];
}

/**
 * The exact words shown on a crisis classification. Written to be steady and
 * non-clinical: it does not diagnose, does not promise the app can help, and
 * points at people rather than at more content.
 */
export function crisisReply(): string {
  return [
    "I'm really glad you told me, and I want to be honest with you: what you're describing is beyond what I can help with, and you deserve someone who can.",
    '',
    'Please reach out to one of the lines below. They are free, confidential, and staffed by people trained for exactly this — right now, not eventually.',
    '',
    "If you're in immediate danger, please call your local emergency number.",
    '',
    "I'll still be here afterwards if you want to sit quietly with a breathing exercise. But please talk to one of them first.",
  ].join('\n');
}

/**
 * Screens model output before it reaches the user. Defence in depth against a
 * model that invents a helpline, claims to be a therapist, or offers a
 * diagnosis — none of which the system prompt can guarantee it will not do.
 */
export function screenOutput(text: string): { safe: boolean; reason: string | null } {
  const lower = text.toLowerCase();

  // A number that looks like a helpline but is not one we published.
  const publishedNumbers = CRISIS_RESOURCES.map((r) => r.contact.toLowerCase());
  const numberLike = text.match(/\b(?:\+?\d[\d\s\-()]{5,}\d)\b/g) ?? [];
  const inventedNumber = numberLike.some(
    (candidate) => !publishedNumbers.some((known) => {
      const knownDigits = known.replace(/\D/g, '');
      return knownDigits.length > 0 && candidate.replace(/\D/g, '').includes(knownDigits);
    }),
  );

  if (inventedNumber && /\b(hotline|helpline|crisis|lifeline|call)\b/.test(lower)) {
    return { safe: false, reason: 'unverified_helpline_number' };
  }

  if (/\b(i am|i'm) (a|your) (therapist|psychiatrist|psychologist|doctor)\b/.test(lower)) {
    return { safe: false, reason: 'claimed_clinical_role' };
  }

  if (/\b(you (have|are suffering from)|i diagnose you with) (depression|anxiety disorder|bipolar|ptsd|ocd)\b/.test(lower)) {
    return { safe: false, reason: 'attempted_diagnosis' };
  }

  return { safe: true, reason: null };
}

/** Replacement text when output screening rejects a response. */
export function screenedReplacement(): string {
  return "I want to be careful here — I'm not able to give clinical advice or point you to a specific service I can't verify. If this is weighing on you, talking to a licensed therapist would help far more than I can. You can book one from the Therapy tab whenever you're ready.";
}
