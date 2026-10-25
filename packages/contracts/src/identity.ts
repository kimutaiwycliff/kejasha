import { z } from 'zod';
import { IdInput, RequiredTextInput, SafeString } from './common';
import { County, Email, KraPin, Phone, PhoneInput } from './kenya';

export const Role = z.enum(['owner', 'manager', 'agent', 'caretaker', 'viewer']).meta({
  id: 'Role',
  description:
    'owner > manager > agent > caretaker; viewer is read-only (dashboards, statements, reports)',
});
export const OrgKind = z.enum(['landlord', 'agency', 'host']).meta({ id: 'OrgKind' });

export const User = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string().nullable().meta({ description: 'Null for phone-only users' }),
    phone: Phone.nullable(),
    emailVerified: z.boolean(),
    phoneVerified: z.boolean(),
  })
  .meta({ id: 'User' });

export const AuthSession = z
  .object({
    token: z
      .string()
      .meta({ description: 'Bearer token for mobile clients. Web relies on the cookie.' }),
    user: User,
  })
  .meta({ id: 'AuthSession' });

const Password = SafeString(128).min(10);

export const SignUpEmailBody = z
  .object({ name: RequiredTextInput(120), email: Email, password: Password })
  .meta({ id: 'SignUpEmailBody' });
export const SignInEmailBody = z
  .object({ email: Email, password: SafeString(128).min(1) })
  .meta({ id: 'SignInEmailBody' });
export const OtpRequestBody = z.object({ phone: PhoneInput }).meta({ id: 'OtpRequestBody' });
export const OtpRequestResult = z
  .object({ expiresInSeconds: z.int() })
  .meta({ id: 'OtpRequestResult' });
export const OtpVerifyBody = z
  .object({ phone: PhoneInput, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })
  .meta({ id: 'OtpVerifyBody' });
export const ForgotPasswordBody = z.object({ email: Email }).meta({ id: 'ForgotPasswordBody' });
export const ResetPasswordBody = z
  .object({ token: SafeString(512).min(1), newPassword: Password })
  .meta({ id: 'ResetPasswordBody' });
export const VerifyEmailBody = z
  .object({ token: SafeString(512).min(1) })
  .meta({ id: 'VerifyEmailBody', description: 'Token from the verification email link' });
export const Accepted = z.object({ ok: z.literal(true) }).meta({ id: 'Accepted' });

export const Membership = z
  .object({ orgId: z.uuid(), orgName: z.string(), kind: OrgKind, role: Role })
  .meta({ id: 'Membership' });
export const Me = z
  .object({ user: User, activeOrg: Membership.nullable(), memberships: z.array(Membership) })
  .meta({ id: 'Me' });
export const SetActiveOrgBody = z.object({ orgId: IdInput }).meta({ id: 'SetActiveOrgBody' });

export const Org = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    kind: OrgKind,
    kraPin: z.string().nullable(),
    phone: Phone.nullable(),
    email: z.string().nullable(),
    county: County.nullable(),
    brandColor: z
      .string()
      .nullable()
      .meta({ description: 'Accent colour on statements (agencies white-label with it)' }),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Org' });
export const CreateOrgBody = z
  .object({
    name: RequiredTextInput(120, 2),
    kind: OrgKind,
    kraPin: KraPin.optional(),
    phone: PhoneInput.optional(),
    email: Email.optional(),
    county: County.optional(),
  })
  .meta({ id: 'CreateOrgBody' });
export const UpdateOrgBody = z
  .object({
    name: RequiredTextInput(120, 2).optional(),
    kraPin: KraPin.nullable().optional(),
    phone: PhoneInput.nullable().optional(),
    email: Email.nullable().optional(),
    county: County.nullable().optional(),
    brandColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #0F766E')
      .nullable()
      .optional(),
  })
  .meta({ id: 'UpdateOrgBody' });

export const Member = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: Phone.nullable(),
    role: Role,
    clientLandlordId: z
      .uuid()
      .nullable()
      .meta({ description: 'Viewers only: the one landlord whose figures they see' }),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Member' });
export const SetMemberScopeBody = z.object({ clientLandlordId: IdInput.nullable() }).meta({
  id: 'SetMemberScopeBody',
  description:
    'Viewers only (422 not_a_viewer). In an agency a viewer needs a landlord to see anything.',
});
export const MemberList = z.object({ items: z.array(Member) }).meta({ id: 'MemberList' });
export const UpdateMemberBody = z.object({ role: Role }).meta({ id: 'UpdateMemberBody' });

export const Invitation = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    orgName: z.string(),
    email: z.string().nullable(),
    phone: Phone.nullable(),
    role: Role,
    status: z.enum(['pending', 'accepted', 'rejected', 'canceled']),
    expiresAt: z.iso.datetime({ offset: true }),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Invitation' });
export const InvitationList = z
  .object({ items: z.array(Invitation) })
  .meta({ id: 'InvitationList' });
export const CreateInvitationBody = z
  .object({
    email: Email.optional(),
    phone: PhoneInput.optional(),
    role: Role,
  })
  .meta({
    id: 'CreateInvitationBody',
    description: 'Exactly one of email or phone (422 email_or_phone otherwise)',
  });

export const IdParam = z.object({ id: IdInput });
