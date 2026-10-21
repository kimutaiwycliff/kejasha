# ADR-016 — Domain is configuration (`APP_DOMAIN`); domain-change runbook

- Status: Accepted · 2026-10-16

## Context
Launch domain is `kejasha.co.ke`, but the owner wants to be able to change it later (rebrand,
`.com`, white-label) without code changes.

## Decision
- One variable, `APP_DOMAIN`, set only in `.env*` / deploy secrets. The config module derives:
  `API_URL = https://api.${APP_DOMAIN}`, `WEB_URL = https://app.${APP_DOMAIN}`,
  `BETTER_AUTH_URL = API_URL`, `EMAIL_FROM = no-reply@${APP_DOMAIN}`, CORS/trusted origins,
  cookie domain `.${APP_DOMAIN}`, Daraja callbacks `${API_URL}/v1/payments/daraja/...`,
  links in SMS/email/PDF templates. Explicit overrides allowed (e.g. local dev).
- Caddyfile uses env placeholders: `api.{$APP_DOMAIN}`, `app.{$APP_DOMAIN}`.
- `LEGACY_DOMAINS` (optional) keeps old domains accepted (CORS + Caddy 301 redirects) during a
  migration window.
- The Android app gets `API_URL` at build time (Gradle `buildConfigField`, ADR-017) **and** checks a tiny remote config
  (`GET ${API_URL}/v1/meta/config` → canonical API URL) so installed apps follow a move while the
  old domain still redirects.
- Guard: a CI test greps source (excluding `.env*`, docs, deploy config) for the literal domain and fails.

## Domain-change runbook (documented in DEPLOYMENT.md when written)
1. Register new domain; add DNS in Cloudflare (`api.`, `app.`).
2. Verify the new sending domain in Resend; update AT sender/WhatsApp profile if needed.
3. Set `APP_DOMAIN=<new>`, `LEGACY_DOMAINS=<old>`; deploy (Caddy issues certs automatically).
4. `make daraja-reregister` — re-registers C2B confirmation/validation URLs for every payment channel.
5. Update Paystack webhook URL and Google/OAuth redirect URIs if used.
6. Ship an Android build with the new `API_URL` (old builds keep working via redirect + remote config).
7. After the migration window, remove `LEGACY_DOMAINS`.

## Consequences
+ Rebrand or white-label is an ops task, not a code change.
− Daraja re-registration and email-domain verification are unavoidable external steps.
