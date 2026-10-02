import { Router } from 'express';

export const legalRouter = Router();

const STYLES = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    max-width: 680px; margin: 0 auto; padding: 40px 20px;
    color: #1a1a2e; line-height: 1.7; background: #fafafa;
  }
  h1 { color: #0B1026; font-size: 28px; margin-bottom: 8px; }
  h2 { color: #131A35; font-size: 20px; margin-top: 32px; }
  .brand { color: #5B7FFF; font-weight: 600; }
  .updated { color: #888; font-size: 14px; margin-bottom: 32px; }
  a { color: #5B7FFF; }
  ul { padding-left: 20px; }
  li { margin-bottom: 8px; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Mindspace</title>
  <style>${STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

/** GET /legal/terms */
legalRouter.get('/terms', (_req, res) => {
  res.type('html').send(page('Terms of Service', `
    <h1>Terms of Service</h1>
    <p class="updated">Last updated: ${new Date().toISOString().slice(0, 10)}</p>

    <p>These Terms of Service ("Terms") govern your use of the <span class="brand">Mindspace</span>
    mobile application and related services (collectively, the "Service") operated by Mindspace
    ("we", "us", or "our").</p>

    <h2>1. Acceptance of Terms</h2>
    <p>By creating an account or using the Service, you agree to be bound by these Terms. If you
    do not agree, do not use the Service.</p>

    <h2>2. Eligibility</h2>
    <p>You must be at least 16 years old to use the Service. If you are under 18, you represent
    that your parent or legal guardian has reviewed and agreed to these Terms on your behalf.</p>

    <h2>3. Accounts</h2>
    <ul>
      <li>You may create an account with an email and password, or continue as a guest.</li>
      <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
      <li>Guest accounts may be converted to full accounts at any time without losing data.</li>
    </ul>

    <h2>4. Subscriptions &amp; Billing</h2>
    <ul>
      <li><strong>Free tier:</strong> Access to the 10-session Basics course, the unguided timer,
      and breathing exercises at no cost.</li>
      <li><strong>Pro tier:</strong> Full library access, offline downloads (up to 50 sessions),
      all courses, and new content weekly. Available as a monthly or annual subscription.</li>
      <li>A 7-day free trial is offered once per account.</li>
      <li>Subscriptions renew automatically unless cancelled at least 24 hours before the end
      of the current period.</li>
      <li>Payment is processed through Apple App Store or Google Play. Manage or cancel your
      subscription in your device's store settings.</li>
      <li>We do not offer refunds directly — refund requests should be directed to the
      respective app store.</li>
    </ul>

    <h2>5. AI Companion</h2>
    <p>The AI companion is a conversational tool designed to support mindfulness practice. It is
    <strong>not a substitute for professional mental health care</strong>. It does not diagnose,
    treat, or offer clinical advice. If you are in crisis, the companion will direct you to
    verified helplines — please use them.</p>

    <h2>6. Therapy Directory</h2>
    <p>Mindspace connects you with independently licensed therapists. We verify licensing
    credentials but do not employ the therapists, supervise their clinical work, or guarantee
    outcomes. Your therapeutic relationship is between you and your therapist.</p>

    <h2>7. Acceptable Use</h2>
    <p>You agree not to:</p>
    <ul>
      <li>Use the Service for any unlawful purpose.</li>
      <li>Attempt to reverse-engineer, decompile, or extract the source code.</li>
      <li>Redistribute, resell, or publicly perform any audio content.</li>
      <li>Use automated systems to access the Service in a manner that exceeds reasonable use.</li>
    </ul>

    <h2>8. Intellectual Property</h2>
    <p>All content — including guided meditations, sleepcasts, music, artwork, and software — is
    owned by Mindspace or its licensors and protected by copyright. Your subscription grants a
    personal, non-transferable licence to stream and download content for private use only.</p>

    <h2>9. Disclaimers</h2>
    <p>The Service is provided "as is" without warranties of any kind. Mindspace does not warrant
    that the Service will be uninterrupted, error-free, or that any health benefits will result
    from use. Meditation and mindfulness are complementary practices, not medical treatments.</p>

    <h2>10. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, Mindspace shall not be liable for any indirect,
    incidental, special, or consequential damages arising out of your use of the Service.</p>

    <h2>11. Account Deletion</h2>
    <p>You may delete your account at any time from Settings. Deletion is immediate and permanent:
    your profile, practice history, and mood data are removed and cannot be recovered. Active
    subscriptions should be cancelled in your device's store settings before deletion.</p>

    <h2>12. Changes to These Terms</h2>
    <p>We may update these Terms from time to time. We will notify you of material changes through
    the app or by email. Continued use after changes constitutes acceptance.</p>

    <h2>13. Governing Law</h2>
    <p>These Terms are governed by applicable law in your jurisdiction. Any disputes shall be
    resolved through binding arbitration or in the courts of competent jurisdiction.</p>

    <h2>14. Contact</h2>
    <p>Questions about these Terms? Contact us at
    <a href="mailto:legal@mindspace.app">legal@mindspace.app</a>.</p>
  `));
});

/** GET /legal/privacy */
legalRouter.get('/privacy', (_req, res) => {
  res.type('html').send(page('Privacy Policy', `
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: ${new Date().toISOString().slice(0, 10)}</p>

    <p>Your privacy matters deeply to us. <span class="brand">Mindspace</span> is a mindfulness
    app, and we believe the data you share while being vulnerable should be treated with the
    highest care. This policy explains what we collect, why, and how we protect it.</p>

    <h2>1. What We Collect</h2>

    <h3>Account data</h3>
    <ul>
      <li>Email address and hashed password (or social sign-in token).</li>
      <li>Display name and timezone.</li>
      <li>Onboarding preferences (experience level, goals, preferred session length).</li>
    </ul>

    <h3>Practice data</h3>
    <ul>
      <li>Session completions, listening time, streak counts.</li>
      <li>Course progress and favourite sessions.</li>
      <li>These are used to personalise your home feed and track your progress.</li>
    </ul>

    <h3>Mood data (sensitive)</h3>
    <ul>
      <li>Mood check-in scores and free-text notes.</li>
      <li><strong>Free-text mood notes are encrypted at rest</strong> using AES-256-GCM before
      they reach the database. A database dump alone does not reveal them.</li>
    </ul>

    <h3>AI companion conversations</h3>
    <ul>
      <li>Conversation history is stored to maintain context within a session.</li>
      <li>You can delete any conversation at any time from the companion screen.</li>
      <li>Conversations flagged as crisis interactions are logged for safety review but
      <strong>never used for model training</strong>.</li>
    </ul>

    <h3>Technical data</h3>
    <ul>
      <li>Device type, OS version, and app version for compatibility.</li>
      <li>IP address for rate limiting and abuse prevention (not stored long-term).</li>
    </ul>

    <h2>2. What We Do NOT Collect</h2>
    <ul>
      <li>We do not sell your data to third parties. Ever.</li>
      <li>We do not use your mood data or conversations for advertising.</li>
      <li>We do not track your location beyond timezone (for streak calculation).</li>
      <li>We do not use your data to train AI models.</li>
    </ul>

    <h2>3. How We Use Your Data</h2>
    <ul>
      <li>To provide and personalise the Service (home feed, recommendations, streaks).</li>
      <li>To process subscriptions and verify entitlements.</li>
      <li>To deliver practice reminders you have opted into.</li>
      <li>To improve the Service through aggregated, anonymised usage patterns.</li>
    </ul>

    <h2>4. Data Storage &amp; Security</h2>
    <ul>
      <li>Data is stored in PostgreSQL with encrypted connections (TLS).</li>
      <li>Passwords are hashed with bcrypt (12 rounds).</li>
      <li>Mood notes are encrypted with AES-256-GCM at the application layer.</li>
      <li>JWT refresh tokens rotate on each use; presenting a stolen token revokes the
      entire token family.</li>
      <li>Redis is used for caching and rate limiting; no sensitive data is persisted there.</li>
    </ul>

    <h2>5. Data Retention</h2>
    <ul>
      <li>Your data is retained as long as your account exists.</li>
      <li>When you delete your account, all personal data — including mood check-ins,
      practice history, and conversations — is permanently removed.</li>
      <li>Anonymised, aggregated statistics may be retained for service improvement.</li>
    </ul>

    <h2>6. Your Rights (GDPR &amp; CCPA)</h2>
    <p>Regardless of where you live, we extend the following rights to all users:</p>
    <ul>
      <li><strong>Access:</strong> Request a copy of all data we hold about you.</li>
      <li><strong>Correction:</strong> Update inaccurate personal information.</li>
      <li><strong>Deletion:</strong> Delete your account and all associated data at any time
      from Settings. This is immediate and irreversible.</li>
      <li><strong>Portability:</strong> Request your data in a machine-readable format.</li>
      <li><strong>Objection:</strong> Opt out of any processing you disagree with.</li>
    </ul>
    <p>To exercise these rights, contact
    <a href="mailto:privacy@mindspace.app">privacy@mindspace.app</a>.</p>

    <h2>7. Third-Party Services</h2>
    <ul>
      <li><strong>AI providers:</strong> Companion conversations are sent to the configured LLM
      provider (e.g., Anthropic, OpenAI, Google) for response generation. We do not permit these
      providers to retain or train on your data beyond what their standard API terms require.</li>
      <li><strong>Payment processors:</strong> Apple and Google handle payment; we never see
      your credit card number.</li>
      <li><strong>Therapy providers:</strong> Booking information is shared with your chosen
      therapist. Their privacy practices are governed by their own policies and professional
      regulations.</li>
    </ul>

    <h2>8. Children's Privacy</h2>
    <p>The Service is not directed at children under 16. We do not knowingly collect personal
    data from children under 16. If you believe a child has provided us with personal data,
    contact us and we will delete it promptly.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We will notify you of material changes through the app or by email. Your continued use
    after the effective date constitutes acceptance of the updated policy.</p>

    <h2>10. Contact</h2>
    <p>For privacy-related questions or data requests:<br>
    <a href="mailto:privacy@mindspace.app">privacy@mindspace.app</a></p>
  `));
});
