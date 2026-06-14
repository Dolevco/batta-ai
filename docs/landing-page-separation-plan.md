# Landing Page Separation Plan

## Goal

Move the public landing page out of `packages/ui` into a separate marketing app that can
later become its own repository. Keep the current landing page as the visual direction:
minimal, dark, calm, and enterprise-security oriented.

## Positioning

Use two clear editions:

- **Batta Community Edition**: the open source, self-managed version. It should point to
  GitHub, docs, local setup, MCP onboarding, repository indexing, and security reviews.
- **Batta Enterprise**: the managed version for organizations. It should focus on managed
  context integrations, incremental indexing/maintenance, credential handling, security
  review workflows, Jira/Slack integration, governance, and support.

The message should be: Community gives teams control and transparency; Enterprise makes
it operational, governed, and reliable at company scale.

## Site Structure

Start simple:

- `/` - product overview, Community/Enterprise split, primary CTAs.
- `/enterprise` - enterprise details and contact form.
- `/security` - factual trust/security posture page.

Later, after the site is stable, add separate `/community`, `/docs`, and customer-facing
case-study pages.

## Enterprise Form

Replace the current waitlist modal with a focused enterprise lead form:

- name
- work email
- company
- role
- company size
- integrations needed
- short message

Keep it security-conscious:

- do not ask for secrets, code, tokens, or architecture details;
- validate server-side;
- add rate limiting and bot protection;
- send leads to a dedicated CRM/form backend, not the product API;
- do not send free-form form contents to analytics.

## Technical Plan

1. Create a standalone landing app, temporarily in this repo as `apps/landing`.
2. Prefer **Astro** unless we need heavy dynamic behavior. It is simpler, fast, SEO-friendly,
   and has a smaller runtime surface.
3. Copy only the brand/theme direction from the current landing page. Do not import
   product UI code from `packages/ui`.
4. Add real product screenshots or sanitized UI captures from the existing app.
5. Deploy the marketing site separately from the product app.
6. Change `packages/ui` so `/` is product/auth focused, not a public marketing page.
7. Move `apps/landing` to its own repository when copy, design, form handling, and deploy
   flow are stable.

## First Implementation Slice

Build only:

- homepage;
- enterprise page;
- security/trust page;
- enterprise contact form UI;
- no real form submission until the backend is chosen.

This keeps the first version small while still moving in the right architectural direction.
