# EduEssentials

A student workspace built with React, Vinext, Cloudflare Workers, and Supabase.

## Local development

Requires Node.js 22.13 or later.

1. Install dependencies with npm install.
2. Copy .env.example to .env and set the Supabase URL, publishable key, and server secret key.
3. Apply the database migrations and Google configuration below.
4. Run npm run dev and open http://127.0.0.1:3000.

The Worker runtime is required because server modules use cloudflare:workers.
The generic vinext start Node server cannot load that module. For a built local
Worker preview use npx wrangler dev --config dist/server/wrangler.json after npm run build.
Supply Supabase runtime values to that preview through Wrangler's environment configuration.

## Required Supabase setup

Apply these SQL files in order using the Supabase SQL editor, or supabase db push
from a linked project. The second migration depends on the first:

- supabase/migrations/20260903000000_workspace_persistence.sql
- supabase/migrations/20260904000000_google_accounts.sql

The new migration adds profile fields, preferences, Google-user profile creation
and identity synchronization triggers, and atomic workspace initialization.
It leaves existing anonymous profiles intact. An unsigned legacy browser cookie
cannot safely prove ownership, so anonymous profiles are not automatically claimed.

In Google Cloud, configure an OAuth client of type Web application:

- Add your app's production origin and local development origin.
- Set the authorized redirect URI to https://<project-ref>.supabase.co/auth/v1/callback.
- Configure the consent screen and testing audience as appropriate.

In Supabase Dashboard > Authentication:

1. Enable the Google provider and enter the Google OAuth client ID and secret.
2. Disable Email, anonymous sign-ins, and any other unused providers. This app
   accepts Google accounts only; it has no password or email-signup flow.
3. Set the Site URL to the deployed app origin.
4. Add the exact app callback URL to the redirect allow list:
   https://<app-domain>/auth/callback.
5. For development, also allow http://127.0.0.1:3000/auth/callback.
   If you use localhost, add http://localhost:3000/auth/callback too.

Google Workspace/school Google accounts are supported as well as gmail.com
accounts. Only basic identity scopes (openid, email, profile) are requested;
the app does not request access to email messages.

Official setup reference: https://supabase.com/docs/guides/auth/social-login/auth-google

## Account and access behavior

- /login and /overview are public. Overview is only a placeholder for future work.
- Google sign-in starts with POST /auth/google and a PKCE exchange at /auth/callback.
- Session cookies are HttpOnly, SameSite=Lax, and Secure in production.
- Middleware refreshes sessions and protects private and future routes by default.
- Each private API independently verifies the user through Supabase getUser().
- New accounts go to /onboarding. A display name is required, prefilled from
  Google, and editable. School, major, year, age, goals, academic structure,
  GPA system, term, week start, and time zone are optional and can be skipped.
- Settings saves profile details, theme, accessibility and notification preferences.
  Notification delivery is not implemented; the UI labels these as saved preferences.
- POST /auth/signout signs out this browser. Write routes require a same-origin request.
- An expired or invalid session returns visitors to login; private APIs return 401.

Profile identity, Google email and avatar, timestamps, onboarding completion, and
preferences are stored in app_profiles. Google Auth manages account credentials.
The app never stores Google passwords or asks users to create a password.

## User-owned persistence

Every course and dashboard query is scoped to the profile resolved from the
verified auth user ID. No caller-supplied profile or user ID grants access.
RLS remains enabled and anon/authenticated roles have no direct table access;
only the server secret performs scoped database operations.

New accounts start with empty courses, assignments, notes, and events, plus the
existing configurable widget layouts. The compact versioned dashboard document
stores widget types, sizes, order, workspace names, active workspace, quick notes,
assignment progress/notes/checklists, calendar events, and chosen views.
Widget instance IDs are regenerated on load. Existing v1 documents remain readable.

First-time initialization is transactional and locks the profile row, so another
tab cannot reinitialize and overwrite a saved layout. Dashboard saves are debounced
and serialized within a tab. Failed saves retain the current edits and show Retry
save; leaving with unsaved edits prompts the browser warning. Concurrent edits
from separate tabs/devices currently use last-write-wins behavior.

## Validation

- npm run build: production Worker build.
- npx tsc --noEmit: TypeScript check.
- npm run lint: lint and accessibility checks.
- npm test: build, account/API tests with a fake Supabase adapter, and HTTP route
  integration tests against a temporary local development server.
- Set TEST_BASE_URL to an existing local preview origin to reuse that server.

Tests exercise Google-only identity, profile validation, ownership isolation,
onboarding enforcement, anonymous route/API denial, CSRF rejection, PKCE initiation,
callback safety and saved workspace round trips. They do not create production
accounts or complete a real Google consent flow. A real end-to-end sign-in and
cross-device save check requires the provider and migration setup above.

## Deployment

Preserve .openai/hosting.json and configure the same Supabase URL, publishable key,
and secret key in the hosted Worker environment. Never include .env in a deployment
archive or place secrets in client components. Deploy only after the migrations
and Google callback allow list are configured for the final app origin.
