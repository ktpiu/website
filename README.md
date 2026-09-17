# Kappa Theta Pi – Alpha Eta (Indiana University)

The official website and member portal for the Alpha Eta chapter of Kappa Theta Pi, the professional technology fraternity at Indiana University.

Repo: [github.com/ktpiu/website](https://github.com/ktpiu/website)

<p align="center">
  <img src="public/ktp-portal-section/dashboard.png" alt="Member portal dashboard" width="49%">
  <img src="public/ktp-portal-section/announcements.png" alt="Announcements" width="49%">
</p>

## What's in here

The repo is a single Next.js 15 app (App Router) that serves two things:

**Public site** – landing page with hero, about, pillars, exec board, standards board, alumni work, tech-passion and community sections, a rush section with FAQ, a `/docs` page, and a `/members` roster. The exec board and roster are driven by role data in Supabase, so they update themselves when roles change in the admin panel.

**Member portal** (`/member-portal`, sign-in required) – everything active members use day to day:

| Area                            | What it does                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                       | Personalized landing page with calendar and announcements widgets                                                                                          |
| Announcements                   | Rich-text posts (Tiptap) with role-based visibility and hidden drafts                                                                                      |
| Calendar                        | Pulls the chapter's public Google Calendar ICS feed, expands recurring events, 5-minute cache                                                              |
| Finances                        | Dues and charges. Members see balances and pay via Stripe (card or ACH with micro-deposit verification). Feature-flagged; falls back to a legacy dues page |
| Internships                     | Daily-refreshed list parsed from the PrepAIJobs Summer Internships GitHub README                                                                           |
| Alumni, Elections, Forms, Merch | Member-facing pages                                                                                                                                        |
| Profile                         | Avatar upload with in-browser cropping, stored in Supabase Storage                                                                                         |
| Admin → Users                   | Approve or deny pending sign-ups, edit members, manage avatars                                                                                             |
| Admin → Roles                   | Create roles, drag-to-reorder priority, assign permissions                                                                                                 |
| Admin → Finance                 | Create charges targeted by role or user, preview recipients, record manual payments, view Stripe payments                                                  |

## Tech stack

| Layer              | Choice                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| Framework          | Next.js 15.3 (App Router, React 19, TypeScript 5)                               |
| Styling            | Tailwind CSS 4, shadcn/ui on Radix primitives, `next-themes` for dark mode      |
| Auth               | Clerk (sign-in, sign-up, webhooks)                                              |
| Database & storage | Supabase Postgres + Storage, using Clerk as a third-party auth provider for RLS |
| Payments           | Stripe (Payment Intents, Setup Intents, webhooks)                               |
| Data fetching      | TanStack Query, SWR, Zustand for client state                                   |
| Feature flags      | Vercel Flags SDK                                                                |
| Hosting            | Vercel (with Cron, Analytics, Speed Insights)                                   |
| Security           | Semgrep CI on every PR and push to `main`                                       |

## How auth and access control work

1. A user signs up through Clerk. A Clerk webhook (`/api/webhooks/clerk`) upserts a row in `public.users` keyed by `clerk_user_id`.
2. New accounts land in a **pending** state. An admin approves or denies them from **Admin → Users**, which is what actually grants portal access. Denied and pending accounts are hidden from the public roster.
3. Authorization is **RBAC**, not a single role column. `roles` ↔ `permissions` via `role_permissions`, and `users` ↔ `roles` via `user_roles`. Roles have a `type` (`general`, `pledge_class`, `exec`, `director`) that also decides where a member appears on the public site.
4. Permission keys live in [lib/permissions.ts](lib/permissions.ts) (`admin.view`, `admin.users.edit`, `admin.finance.view`, etc.). Server routes check them with the Supabase service client; client pages gate UI with the same helpers.
5. Supabase RLS uses Clerk JWTs as a third-party provider, so browser reads go through RLS while privileged writes use the service-role client in [lib/supabase-admin.ts](lib/supabase-admin.ts).

Route protection for `/member-portal/*` is enforced in [middleware.ts](middleware.ts) with `clerkMiddleware`.

## Finance model

Charges are created by admins and resolved into per-member **obligations**. Amounts can be set as a default, per role, or per user, and the preview endpoint surfaces conflicts (a member in two roles with different amounts) before anything is written.

Payments come from Stripe or are entered manually, and are **allocated** to obligations either FIFO or by explicit selection. Balances (`paid`, `partial`, `unpaid`, overdue) are computed in the `finance_obligation_balances` view. The Stripe webhook handles `payment_intent.*` and `setup_intent.*` events to keep payment status in sync.

The whole Stripe flow is behind the `stripe-payments` Vercel flag ([lib/flags.ts](lib/flags.ts)). When it is off, members see the legacy dues page.

## Getting started

### Prerequisites

- Node 20+
- A Clerk application
- A Supabase project with the migrations in `supabase/migrations` applied
- A Stripe account (test mode is fine) if you want to work on finances

### Install and run

```bash
npm install
```

```bash
cp env.example .env.local
```

Fill in `.env.local` (see below), then:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

### Environment variables

| Variable                                                                    | Required | Purpose                                                   |
| --------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                         | yes      | Clerk client key                                          |
| `CLERK_SECRET_KEY`                                                          | yes      | Clerk server key (also used by the backfill script)       |
| `CLERK_WEBHOOK_SIGNING_SECRET`                                              | yes      | Verifies `/api/webhooks/clerk`                            |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` etc.                                        | no       | Override Clerk redirect paths (defaults in `env.example`) |
| `NEXT_PUBLIC_SUPABASE_URL`                                                  | yes      | Supabase project URL                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | yes      | Browser Supabase key                                      |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)                      | yes      | Server-side privileged client                             |
| `SUPABASE_AVATARS_BUCKET`                                                   | no       | Storage bucket for avatars                                |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`                  | finance  | Stripe keys                                               |
| `STRIPE_WEBHOOK_SECRET`                                                     | finance  | Verifies `/api/stripe/webhooks`                           |
| `STRIPE_API_TEST` / `NEXT_PUBLIC_STRIPE_API_TEST`                           | no       | Force Stripe test mode                                    |
| `CRON_SECRET`                                                               | prod     | Protects the internships refresh cron endpoint            |

For local webhooks, tunnel with the Clerk and Stripe CLIs (or ngrok) and point each dashboard at your tunnel URL.

### Scripts

| Command                        | What it does                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Start the dev server                                                                                                                                  |
| `npm run build` / `npm start`  | Production build and serve                                                                                                                            |
| `npm run lint`                 | ESLint (Next config)                                                                                                                                  |
| `npm run backfill:clerk-users` | Link existing Clerk users to `public.users` by `clerk_user_id`, then email. Add `-- --dry-run` to preview or `-- --create` to create missing profiles |

## Project layout

```
app/
  (auth)/            sign-in, sign-up, forgot-password (Clerk Elements)
  (public)/          landing page, /docs, /members
  member-portal/     authenticated portal pages, incl. admin/{users,roles,finance}
  api/
    admin/           pending-user approval, avatar management
    finance/         member overview + admin charges/payments
    stripe/          customers, payment methods, setup intents, webhooks
    webhooks/clerk/  Clerk user sync
    calendar/        ICS proxy + recurrence expansion
    internships/     GitHub README parser + cron refresh
components/
  sections/          public landing-page sections
  member-portal/     portal widgets, sidebar, editor, admin & finance UIs
  auth/              AuthProvider, ProtectedRoute, Unauthorized
  ui/                shadcn/ui primitives
lib/                 auth, permissions, Supabase/Stripe clients, finance logic, ICS parser
supabase/migrations/ schema for RBAC, approvals, Clerk auth linkage
scripts/             one-off maintenance (Clerk → Supabase backfill)
```

## Deployment

The site deploys on Vercel from `main`. Set every variable from the table above in the Vercel project, and register the Clerk and Stripe webhook endpoints against the production domain.

## Contributing

1. Branch off `main`, keep PRs focused.
2. Run `npm run lint` before pushing.
3. Schema changes go in a new timestamped file under `supabase/migrations/`. Do not edit `database-updates.sql`, which is historical.
4. New admin features should gate on a permission key from [lib/permissions.ts](lib/permissions.ts) rather than a hard-coded role.

Questions? Open an issue on the repo or reach out to the chapter tech team.
