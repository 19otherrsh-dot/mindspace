import { assessRisk, screenOutput, crisisReply, screenedReplacement } from './safety.ts';

describe('Safety Module', () => {
  describe('assessRisk', () => {
    it('detects crisis keywords reliably regardless of casing and spacing', () => {
      expect(assessRisk('I want to kill myself')).toEqual({
        level: 'crisis',
        category: 'suicidal_intent',
      });
      expect(assessRisk('i wanna die')).toEqual({
        level: 'crisis',
        category: 'suicidal_intent',
      });
      expect(assessRisk('im having chest pain')).toEqual({
        level: 'crisis',
        category: 'medical_emergency',
      });
      expect(assessRisk('I am going to jump off a building')).toEqual({
        level: 'crisis',
        category: 'suicide_plan',
      });
    });

    /*
     * Letter-spacing defeated the classifier until both words being spaced out
     * was handled: normalising "k i l l  m y s e l f" collapses the gap
     * between the words too, producing "killmyself", which a pattern written
     * with a literal space cannot match. These are the phrasings that slipped
     * through, and a crisis message reaching the model instead of the helpline
     * is the worst failure this system has.
     */
    it('sees through letter-spacing on both words', () => {
      const spaced = [
        'i want to k i l l  m y s e l f',
        'i want to k.i.l.l m.y.s.e.l.f',
        'K I L L   M Y S E L F',
        'i want to e n d  m y  l i f e',
      ];

      for (const message of spaced) {
        expect(assessRisk(message)).toEqual({
          level: 'crisis',
          category: 'suicidal_intent',
        });
      }
    });

    it('still sees through spacing on a single word', () => {
      expect(assessRisk('i want to k i l l myself')).toEqual({
        level: 'crisis',
        category: 'suicidal_intent',
      });
      expect(assessRisk('i want to kill  myself')).toEqual({
        level: 'crisis',
        category: 'suicidal_intent',
      });
    });

    it('does not fire on ordinary text that survives despacing', () => {
      // The despaced pass drops word boundaries, so these guard the edge it
      // opens up: innocuous phrases must not collide once spaces are removed.
      for (const message of [
        'i want to kill time before my meeting',
        'the killer feature is the timer',
        'i want to end my subscription',
        'my life is busy but fine',
        'we should end my trial early',
      ]) {
        expect(assessRisk(message).level).toBe('none');
      }
    });

    it('detects elevated risk levels', () => {
      expect(assessRisk('Im having a panic attack')).toEqual({
        level: 'elevated',
        category: 'panic',
      });
      expect(assessRisk('I feel so worthless today')).toEqual({
        level: 'elevated',
        category: 'hopelessness',
      });
      expect(assessRisk('I can\'t cope anymore')).toEqual({
        level: 'elevated',
        category: 'severe_distress',
      });
    });

    it('returns none for safe messages', () => {
      expect(assessRisk('I am feeling a bit sad today')).toEqual({
        level: 'none',
        category: null,
      });
      expect(assessRisk('How do I meditate?')).toEqual({
        level: 'none',
        category: null,
      });
      expect(assessRisk('I want to kill time')).toEqual({
        level: 'none',
        category: null,
      });
    });
  });

  describe('screenOutput', () => {
    it('allows safe output', () => {
      expect(screenOutput('It sounds like you are having a hard time. Breathe.')).toEqual({
        safe: true,
        reason: null,
      });
    });

    it('blocks unverified helpline numbers', () => {
      // Must include a crisis keyword to trigger the check
      expect(screenOutput('You should call this crisis hotline: 1-800-123-4567')).toEqual({
        safe: false,
        reason: 'unverified_helpline_number',
      });
    });

    it('allows published verified helplines', () => {
      // 988 is a known helpline in CRISIS_RESOURCES
      expect(screenOutput('You can reach out to the crisis lifeline at 988.')).toEqual({
        safe: true,
        reason: null,
      });
    });

    it('blocks claiming clinical roles', () => {
      expect(screenOutput('I am your therapist, please tell me more.')).toEqual({
        safe: false,
        reason: 'claimed_clinical_role',
      });
      expect(screenOutput('I am a doctor, I think you should sleep.')).toEqual({
        safe: false,
        reason: 'claimed_clinical_role',
      });
    });

    it('blocks attempted diagnosis', () => {
      expect(screenOutput('I diagnose you with depression.')).toEqual({
        safe: false,
        reason: 'attempted_diagnosis',
      });
      expect(screenOutput('You are suffering from bipolar.')).toEqual({
        safe: false,
        reason: 'attempted_diagnosis',
      });
    });
  });

  describe('Replacements', () => {
    it('returns a non-empty string for crisis replies', () => {
      expect(crisisReply().length).toBeGreaterThan(0);
      expect(crisisReply()).toContain('honest');
    });

    it('returns a non-empty string for screened replacements', () => {
      expect(screenedReplacement().length).toBeGreaterThan(0);
      expect(screenedReplacement()).toContain('clinical advice');
    });
  });
});
