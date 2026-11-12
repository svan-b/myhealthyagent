import type { Metadata } from 'next';
import { LegalPage } from '../components/legal/LegalPage';
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'Terms and medical disclaimer' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms and medical disclaimer" updated="November 12, 2026">
      <h2>Not medical advice</h2>
      <p>
        myHealthyAgent is a personal diary and pattern finding tool. It is not a medical device. It does not diagnose,
        treat, cure or prevent any condition, and nothing in it is medical advice. “Possible triggers” and other
        patterns are statistical associations in the data you entered. They can be wrong, they can be caused by chance
        or by things you did not log, and they do not prove cause.
      </p>
      <p>
        Do not start, stop or change any treatment, medication or diet based on this app without talking to a qualified
        health professional. If you think you may have a medical emergency, call your local emergency number right away.
      </p>

      <h2>Your data</h2>
      <p>
        Your entries are stored on your device and belong to you. You are responsible for keeping backups. We are not
        able to recover data that is lost from your device. See the <a href="/privacy">privacy notice</a> for details.
      </p>

      <h2>Pro</h2>
      <p>
        Some features may require a paid Pro license. Prices are shown before checkout. Subscriptions renew
        automatically until cancelled, and you can cancel at any time from Manage billing; access continues until the
        end of the paid period. Payments are processed by Stripe. If something is wrong with a charge, contact us and we
        will make it right.
      </p>
      <p>A license key is for your personal use. Please do not share or resell it.</p>

      <h2>Acceptable use</h2>
      <p>Do not attempt to disrupt the service, bypass licensing, or use the app in a way that breaks the law.</p>

      <h2>No warranty</h2>
      <p>
        The app is provided “as is” without warranties of any kind. To the extent the law allows, we are not liable for
        indirect or consequential losses, or for decisions made based on the app. Nothing here limits rights you have
        under consumer protection law.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms. Continued use after an update means you accept it. Questions:{' '}
        {config.supportEmail ? (
          <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>
        ) : (
          'use the contact details on the site where you found this app'
        )}
        .
      </p>
    </LegalPage>
  );
}
