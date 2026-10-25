import type { Config } from '@kejasha/config';
import { phone as phoneLib } from '@kejasha/core';
import { schema, type Db } from '@kejasha/db';
import type { SmsSender } from '@kejasha/integrations-africastalking';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, organization, phoneNumber } from 'better-auth/plugins';
import { isPhoneEmail, phoneEmail } from './phone-email';
import { ac, accessRoles } from './roles';

export interface AuthDeps {
  config: Config;
  db: Db;
  sms: SmsSender;
  /** Called with the reset token; the identity module enqueues the email (outbox). */
  onPasswordReset: (data: { email: string; name: string; token: string }) => Promise<void>;
  /** Called with an email-verification token (sign-up or resend); the email goes via the outbox. */
  onVerifyEmail: (data: { email: string; name: string; token: string }) => Promise<void>;
}

export const OTP_TTL_SECONDS = 300;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Better Auth (ADR-004). Runs on the owner pool: its tables are platform tables. Clients never call
 * it directly — the identity module wraps `auth.api.*` in contract routes (ADR-017).
 */
export function createAuth(deps: AuthDeps) {
  const { config, db, sms } = deps;
  if (!config.auth.secret) throw new Error('BETTER_AUTH_SECRET is required');

  return betterAuth({
    appName: 'Kejasha',
    secret: config.auth.secret,
    baseURL: config.auth.url,
    basePath: '/v1/auth',
    trustedOrigins: config.domain.trustedOrigins,
    telemetry: { enabled: false },
    // Our own Redis-backed limiter guards the contract routes.
    rateLimit: { enabled: false },
    database: drizzleAdapter(db.owner, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'kj',
      useSecureCookies: config.isProduction,
      ...(config.domain.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: config.domain.cookieDomain } }
        : {}),
    },
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: 60 * 60 * 24 },
    // Email invitations are accepted only by verified addresses (security review H1).
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, token }) => {
        if (isPhoneEmail(user.email)) return;
        await deps.onVerifyEmail({ email: user.email, name: user.name, token });
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, token }) => {
        await deps.onPasswordReset({ email: user.email, name: user.name, token });
      },
    },
    plugins: [
      organization({
        ac,
        roles: accessRoles,
        creatorRole: 'owner',
        allowUserToCreateOrganization: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        teams: { enabled: false },
        schema: {
          organization: {
            additionalFields: {
              kind: { type: 'string', required: true, input: true },
            },
          },
        },
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: OTP_TTL_SECONDS,
        allowedAttempts: 5,
        phoneNumberValidator: (value) => phoneLib.normalizeKenyanPhone(value) === value,
        sendOTP: async ({ phoneNumber: to, code }) => {
          await sms.send({
            to,
            message: `Your Kejasha code is ${code}. It expires in ${OTP_TTL_SECONDS / 60} minutes. Do not share it.`,
          });
        },
        signUpOnVerification: {
          getTempEmail: phoneEmail,
          getTempName: (value) => value,
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
