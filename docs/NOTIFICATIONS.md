# Company-Specific Email Notifications

The alert system is opt-in and selects no companies by default. A subscriber can choose a recommended field list or start empty, edit the selection, and must verify their email before alerts become active.

## Components

- `docs/notifications/` is the static signup and preference-management interface.
- `data/company_metadata.json` owns canonical aliases, parent companies, discipline-specific standout designations, and recommendation presets.
- `data/company_catalog.json` and `docs/notifications/catalog.json` are generated public catalogs. They never contain subscriber data.
- `supabase/migrations/` stores subscribers, preferences, ingested roles, delivery idempotency records, and provider events.
- `subscription-api` handles double opt-in, preference changes, and unsubscribe links.
- `ingest-roles` accepts a signed post-scan outbox and sends one digest per subscriber per scan.
- `resend-webhook` records delivery events and suppresses bounced or complained recipients.

Email addresses and subscription rows live only in Supabase. They must never be written to this repository, workflow artifacts, or logs.

## Deploy

The public signup URL is `https://new-grad-and-internships-2027.pages.dev/notifications/`. Cloudflare Pages is connected to the private GitHub repository, publishes `docs/`, and rebuilds automatically after pushes to `main`. The Cloudflare GitHub App is restricted to this repository.

In Cloudflare Pages, use these build settings:

- Production branch: `main`
- Build command: `node scripts/configure_notification_site.mjs`
- Build output directory: `docs`

The signup interface can be deployed before the backend, but subscriptions will remain unavailable until `NOTIFICATION_PUBLIC_API_URL` points to the deployed `subscription-api` function.

1. Create a Supabase project and apply `supabase/migrations/202608090001_role_alerts.sql`.
2. Deploy the three functions in `supabase/functions/`.
3. Verify a sending domain with Resend and create a webhook for delivery, bounce, complaint, and suppression events.
4. Set these Supabase function secrets:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
   - `RESEND_WEBHOOK_SECRET`
   - `MAIL_FROM`, such as `2027 Role Alerts <alerts@example.com>`
   - `MAILING_ADDRESS`, used in email footers
   - `PUBLIC_SITE_URL`: `https://new-grad-and-internships-2027.pages.dev/notifications/`
   - `SUBSCRIPTION_API_URL`, the deployed `subscription-api` URL used for one-click unsubscribe
   - `ALLOWED_ORIGINS`, a comma-separated allowlist containing the public site's origin
   - `MAGIC_LINK_SECRET`, at least 32 random characters
   - `INGEST_SECRET`, a separate random secret for GitHub Actions
   - `TURNSTILE_SECRET_KEY` if bot protection is enabled

5. Add Cloudflare Pages build variables. The build command writes these public values into the deployed `config.js`; they are not secrets:

   - `NOTIFICATION_PUBLIC_API_URL`: the deployed `subscription-api` URL
   - `TURNSTILE_SITE_KEY`: the public Turnstile site key, if bot protection is enabled

6. Add GitHub Actions repository secrets:

   - `NOTIFICATION_API_URL`: deployed `ingest-roles` URL
   - `NOTIFICATION_INGEST_SECRET`: the same value as `INGEST_SECRET`

7. Run the monitor workflow once before enabling signups. Its notification dispatch seeds the private `companies` table from the generated catalog even when there are no new roles, allowing subscription selections to pass server-side validation.

The monitor safely skips dispatch when those GitHub secrets are absent.

Run `npm run check:functions` before deploying Edge Function changes.

## Delivery guarantees

- Every role has a deterministic `role_id` based on its canonical requisition identity.
- `(subscriber_id, role_id)` is unique, preventing ordinary workflow retries from sending the same role twice.
- Resend receives a deterministic idempotency key for each subscriber digest.
- Parent subscriptions match child companies. For example, an RTX subscription also matches Collins Aerospace and Pratt & Whitney roles.
- Unsubscribe invalidates all older management links by incrementing the subscriber's token version.
- Verification and management email requests are throttled per address, and suppressed recipients are not silently reactivated.
- Bounces, complaints, and provider suppressions stop future sends.

## Privacy and operations

Publish a privacy notice before enabling signups. Keep the consent language explicit, include a working one-click unsubscribe path in every alert, use accurate sender information, and configure a valid mailing address. Establish a retention policy for unsubscribed addresses and delivery logs before production launch.
