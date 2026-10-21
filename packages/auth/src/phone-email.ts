/**
 * Better Auth requires an email on every user. Phone-only users (tenants, caretakers) get a
 * deterministic placeholder on the reserved `.invalid` TLD, so SMS invitations can target it and
 * Better Auth's email-matching invitation acceptance works unchanged.
 */
const DOMAIN = 'phone.invalid';

export function phoneEmail(e164: string): string {
  return `${e164.replace(/^\+/, '')}@${DOMAIN}`;
}

export function isPhoneEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DOMAIN}`);
}

export function phoneFromPhoneEmail(email: string): string | null {
  return isPhoneEmail(email) ? `+${email.split('@')[0]}` : null;
}
