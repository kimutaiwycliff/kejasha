import type { Config } from '@kejasha/config';

/** Outgoing message content owned by the identity module. Sent via the outbox (notifications.*). */
export interface EmailPayload extends Record<string, unknown> {
  to: string;
  subject: string;
  text: string;
}
export interface SmsPayload extends Record<string, unknown> {
  to: string;
  message: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'an owner',
  manager: 'a manager',
  agent: 'an agent',
  caretaker: 'a caretaker',
};

export function passwordResetEmail(
  config: Config,
  d: { email: string; name: string; token: string },
): EmailPayload {
  const url = `${config.domain.webUrl}/reset-password?token=${encodeURIComponent(d.token)}`;
  return {
    to: d.email,
    subject: 'Reset your Kejasha password',
    text: `Hi ${d.name},\n\nUse this link to set a new password (valid for 1 hour):\n${url}\n\nIf you did not ask for this, ignore this email.`,
  };
}

export function verifyEmailMessage(
  config: Config,
  d: { email: string; name: string; token: string },
): EmailPayload {
  const url = `${config.domain.webUrl}/verify-email?token=${encodeURIComponent(d.token)}`;
  return {
    to: d.email,
    subject: 'Confirm your email for Kejasha',
    text: `Hi ${d.name},\n\nConfirm this email address (valid for 24 hours):\n${url}\n\nIf you did not sign up for Kejasha, ignore this email.`,
  };
}

export function invitationEmail(
  config: Config,
  d: { to: string; orgName: string; inviterName: string; role: string; invitationId: string },
): EmailPayload {
  const url = `${config.domain.webUrl}/invitations/${d.invitationId}`;
  return {
    to: d.to,
    subject: `${d.inviterName} invited you to ${d.orgName} on Kejasha`,
    text: `${d.inviterName} invited you to join ${d.orgName} on Kejasha as ${ROLE_LABEL[d.role] ?? d.role}.\n\nAccept the invitation: ${url}\n\nThe invitation expires in 7 days.`,
  };
}

export function invitationSms(
  config: Config,
  d: { to: string; orgName: string; role: string },
): SmsPayload {
  return {
    to: d.to,
    message: `You've been invited to ${d.orgName} on Kejasha as ${ROLE_LABEL[d.role] ?? d.role}. Sign in with this number at ${config.domain.webUrl} or the Kejasha app to accept.`,
  };
}
