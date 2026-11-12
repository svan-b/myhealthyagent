import type { Metadata } from 'next';
import { LegalPage } from '../components/legal/LegalPage';
import { config } from '@/lib/config';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="November 12, 2026">
      <p>
        The short version: your health information never leaves your device. We cannot see it, sell it or hand it over,
        because we never have it.
      </p>

      <h2>What stays on your device</h2>
      <p>
        Everything you log (symptoms, foods, activities, medications, doses, notes and the name you put on reports) is
        stored in your browser’s local storage on the device you are using. Trigger analysis and PDF reports are
        computed on the device too. None of it is sent to us or to anyone else. If you buy Pro, your license key is
        stored there as well, and in backups.
      </p>
      <p>
        Because nothing is stored on a server, we cannot recover your data if you clear your browser data, uninstall the
        app or lose your device. Use “Download backup” regularly and keep the file somewhere safe. Backup files are not
        encrypted, so store them as carefully as you would any medical document.
      </p>

      <h2>What reaches a server</h2>
      <ul>
        <li>
          <strong>Loading the app.</strong> Like any website, our hosting provider receives standard request information
          such as your IP address and browser type in order to serve the app. We do not use this to identify you.
        </li>
        <li>
          <strong>Payments, only if you buy Pro.</strong> Checkout is handled by Stripe. Stripe collects your payment
          details and email under its own privacy policy. We receive your purchase status and references to your Stripe
          customer and purchase so we can issue a license key. We never receive health data, and your license key
          contains no health data, only those references.
        </li>
        <li>
          <strong>License checks.</strong> If you have Pro, the app sends your license key to our server about once a
          day, and the server asks Stripe whether the purchase still counts (an active subscription, or a one time
          purchase that was not refunded or reversed).
        </li>
        {config.billingPortalUrl && (
          <li>
            <strong>Billing.</strong> “Manage billing” opens Stripe’s billing portal, where Stripe emails you a code to
            sign in. Your license key is not used for it, so someone who has your key cannot see your billing details.
          </li>
        )}
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>No accounts, no analytics, no advertising, no tracking cookies and no third party trackers.</li>
        <li>No selling or sharing of personal data, and no use of your data to train models.</li>
      </ul>

      <h2>Your choices</h2>
      <p>
        You can export everything as a backup or spreadsheet, and erase everything on this device with “Delete all data”
        in Reports and data. That removes your Pro license key too, unless you tick “Keep my Pro license key on this
        device”, so copy the key first if you want to use Pro again. You can also remove just the key in the Pro
        section. Because we do not hold your health data, there is nothing for us to delete on a server.{' '}
        {config.billingPortalUrl
          ? 'For payment records, use “Manage billing” in Reports and data, or contact us.'
          : 'For payment records, contact us.'}
      </p>

      <h2>Children</h2>
      <p>The app is not directed at children under 13.</p>

      <h2>Changes and contact</h2>
      <p>
        If this notice changes, the date above will change. Questions:{' '}
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
