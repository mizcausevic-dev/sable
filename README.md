# Sable

Sable is a multi-tenant operations application for an agency. One organization holds its clients, projects, tasks, time, and revenue. A person in another organization cannot read or change those rows. Database policies are the read authority. Server actions check the same role matrix before they write.

Currency is chosen when the organization is created and does not change. Amounts are integer minor units. One US cent is `1`. Reports add those integers. They do not mix currencies and they do not use floating-point arithmetic.

## Stack

Recorded in `package-lock.json`.

- Next.js 16.4.2, React 19.3.1, TypeScript 5.9.3
- Tailwind CSS 4.3.3
- Zod 4.6.7
- PostgreSQL through `DATABASE_URL` (`postgres` 3.4.9), or embedded PGlite 0.5.10 when that variable is empty
- Optional Supabase Auth (`@supabase/supabase-js` 2.118.0) and a private Storage bucket
- Vitest 5.0.5 and Playwright 1.64.1

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000/login. With `DATABASE_URL` empty, the first request creates `.data/pglite`, applies `supabase/migrations`, and loads the fictional seed when the users table is empty.

Seed password for every fictional person: `Sable-demo-1`

| Email | Organization | Role |
| --- | --- | --- |
| mira.ellison@northline.test | Northline Studio | owner |
| jonah.adler@northline.test | Northline Studio, and Harbor & Co | admin, contributor |
| leo.park@northline.test | Northline Studio | contributor |
| ava.quinn@brightparcel.test | Northline Studio | client, Bright Parcel and the Parcel tracking project only |
| owen.marsh@harbor.test | Harbor & Co | owner |

Do not point this seed at a database you care about. The seed runs only when `users` is empty, or when you run `npm run seed`.

## Scripts

- `npm run dev` starts the app
- `npm run build` then `npm start` runs the production server
- `npm run typecheck`
- `npm test` runs unit and database integration tests
- `npm run test:e2e` runs Playwright against a development server on port 3210
- `npm run db:migrate` applies SQL migrations to the configured database
- `npm run seed` inserts the fictional dataset
- `npm run preview:export` copies the static operating map to `site/index.html`

## Production database

Set `DATABASE_URL` to Postgres 15 or newer. Apply `supabase/migrations/20261020120000_init.sql` with a role that can create `app_user`. On Supabase, run that file in the SQL editor before the first deploy. Leave `SEED_ON_BOOT` unset in production unless you intentionally want the fictional organizations on an empty database.

Set `SESSION_SECRET` to at least 32 characters.

Supabase Auth is optional. When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both set, sign-in checks Supabase and then requires a linked `users` row. Otherwise Sable stores a scrypt password hash and an HMAC session cookie. The service-role key stays on the server.

## Files

Uploads are PDF, PNG, JPEG, WebP, GIF, plain text, or CSV, at most 10 MB, checked against the declared type and the file header. The `attachments` row is inserted under the caller's row-level security policy. Bytes go to the private `sable-private` bucket when `SUPABASE_SERVICE_ROLE_KEY` is set, and to `DATA_DIR/storage` otherwise. Download routes load the row first. A client receives a file only when it is marked non-internal and attached to an assigned client, project, or visible task.

`private.within_storage_limit` is security definer so a contributor can be held to the organization cap without a grant to read the subscription row. It refuses callers who are not staff of that organization.

## Privileged database paths

`src/lib/privileged.ts` lists them. `withService` runs as the database owner and bypasses row-level security. It is used for migrations, seed, user registration, login lookup, linking a Supabase user, and reading an invitation before the visitor has a session. Every other request sets `app.user_id` and `set local role app_user`.

Security-definer functions (`create_organization`, `accept_invitation`, `revoke_invitation`, `set_member_role`, `remove_member`, `notify`, `write_audit`, `within_storage_limit`) run as the owner after checking the caller. Application code cannot insert `audit_events` directly. The table has a select grant for owners and admins and no insert grant for `app_user`.

A submitted organization id is never treated as proof of access. The active organization is the caller's membership matching the `sable_org` cookie, or their first membership.

## Money and reports

Recognized revenue is the sum of totals on issued, partial, and paid invoices whose issued date is inside the range. Outstanding is the current balance of the issued and partial invoices in that set. Collected is payments whose received date is inside the range, split into manual and provider-confirmed. Gross profit is recognized revenue minus delivery cost from time entries in the range. Margin is omitted when recognized revenue is zero.

A manual payment is a ledger entry. A provider-confirmed payment requires `PAYMENT_PROVIDER` and a reference. Neither path charges a card. The billing screen says **Mock billing adapter** when no provider is configured.

CSV export prefixes cells that start with `=`, `+`, `-`, `@`, or a tab so a spreadsheet does not treat them as formulas.

## Notifications

In-app notifications are written. Email and push checkboxes are stored on `notification_preferences` and are not delivered. Invitation acceptance returns a link in the page. No mail is sent.

## What is not in this release

- No card charge, checkout, or webhook. Provider rows are ledger entries.
- No email or push delivery.
- No second currency and no workspace level above the organization.
- GitHub Pages can publish the static operating map only. The application needs a Node server and Postgres.
- Calendar view is the month of task and milestone dates. It is not a scheduling suite.
- Supabase Storage is used only when the service-role key is present. The seed file is written to local disk.

## Deploy

Vercel: set the environment variables from `.env.example`, including `DATABASE_URL` and `SESSION_SECRET`. Do not rely on the embedded database on a serverless host. The filesystem is not durable there.

The static map is `docs/sable-operating-map-Cursor.html`. `npm run preview:export` writes `site/index.html` for a GitHub Pages branch that serves `/site` or the repository root of that branch.
