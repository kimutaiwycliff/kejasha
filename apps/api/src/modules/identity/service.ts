import {
  grantableRoles,
  isPhoneEmail,
  isRole,
  phoneEmail,
  phoneFromPhoneEmail,
  type Role,
} from '@kejasha/auth';
import type { z } from 'zod';
import type {
  AuthSession,
  CreateInvitationBody,
  CreateOrgBody,
  Invitation,
  Me,
  Member,
  Membership,
  Org,
  UpdateOrgBody,
  User,
} from '@kejasha/contracts';
import { and, eq, gt, inArray, schema, sql, withTenant } from '@kejasha/db';
import { enqueueInTx } from '@kejasha/jobs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { audit } from '../../lib/audit';
import { forwardAuthHeaders, toFetchHeaders } from '../../lib/headers';
import type { OrgCreatedHook } from '../../lib/org-hooks';
import { invitationEmail, invitationSms } from './messages';

type UserDto = z.infer<typeof User>;
type OrgDto = z.infer<typeof Org>;

interface AuthUserLike {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
}

export function toUser(u: AuthUserLike): UserDto {
  const phoneOnly = isPhoneEmail(u.email);
  return {
    id: u.id,
    name: u.name,
    email: phoneOnly ? null : u.email,
    phone: u.phoneNumber ?? phoneFromPhoneEmail(u.email),
    emailVerified: phoneOnly ? false : u.emailVerified,
    phoneVerified: Boolean(u.phoneNumberVerified),
  };
}

const iso = (d: Date) => d.toISOString();

export function createIdentityService(
  deps: AppDeps,
  hooks: {
    orgCreated: OrgCreatedHook[];
    memberRemoved: ((tx: Parameters<OrgCreatedHook>[0], userId: string) => Promise<void>)[];
  },
) {
  const { auth, db, config } = deps;

  async function session(
    req: FastifyRequest,
    reply: FastifyReply,
    call: Promise<{ headers: Headers; response: { token: string | null; user: AuthUserLike } }>,
  ): Promise<z.infer<typeof AuthSession>> {
    const { headers, response } = await call;
    forwardAuthHeaders(headers, reply);
    if (!response.token)
      throw new AppError(401, 'session_not_created', 'Sign-in failed', 'No session was created.');
    return { token: response.token, user: toUser(response.user) };
  }

  async function loadUser(userId: string): Promise<UserDto> {
    const [u] = await db.owner.select().from(schema.user).where(eq(schema.user.id, userId));
    if (!u) throw new AppError(401, 'unauthenticated', 'Unauthenticated');
    return toUser(u);
  }

  async function memberships(userId: string): Promise<z.infer<typeof Membership>[]> {
    const rows = await db.owner
      .select({
        orgId: schema.organization.id,
        orgName: schema.organization.name,
        kind: schema.organization.kind,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, userId))
      .orderBy(schema.organization.name);
    return rows;
  }

  async function me(req: FastifyRequest): Promise<z.infer<typeof Me>> {
    const actor = req.actor!;
    const [user, list] = await Promise.all([loadUser(actor.userId), memberships(actor.userId)]);
    return {
      user,
      memberships: list,
      activeOrg: list.find((m) => m.orgId === actor.orgId) ?? null,
    };
  }

  async function memberOf(orgId: string, memberId: string) {
    const [m] = await db.owner
      .select()
      .from(schema.member)
      .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, orgId)));
    if (!m) throw AppError.notFound('Member');
    return m;
  }

  async function ownerCount(orgId: string): Promise<number> {
    const [row] = await db.owner
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.role, 'owner')));
    return row?.n ?? 0;
  }

  async function loadOrg(req: FastifyRequest, orgId: string): Promise<OrgDto> {
    const [org] = await db.owner
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId));
    if (!org) throw AppError.notFound('Organization');
    const [profile] = await withTenant(db, { orgId, userId: req.actor?.userId }, (tx) =>
      tx.select().from(schema.orgProfile).where(eq(schema.orgProfile.orgId, orgId)),
    );
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      kind: org.kind,
      kraPin: profile?.kraPin ?? null,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
      county: (profile?.county as OrgDto['county']) ?? null,
      createdAt: iso(org.createdAt),
    };
  }

  function toInvitation(
    row: typeof schema.invitation.$inferSelect,
    orgName: string,
  ): z.infer<typeof Invitation> {
    const phone = phoneFromPhoneEmail(row.email);
    return {
      id: row.id,
      orgId: row.organizationId,
      orgName,
      email: phone ? null : row.email,
      phone,
      role: isRole(row.role) ? row.role : 'agent',
      status: row.status as z.infer<typeof Invitation>['status'],
      expiresAt: iso(row.expiresAt),
      createdAt: iso(row.createdAt),
    };
  }

  return {
    signUpEmail: (
      req: FastifyRequest,
      reply: FastifyReply,
      body: { name: string; email: string; password: string },
    ) =>
      session(
        req,
        reply,
        auth.api.signUpEmail({ body, headers: toFetchHeaders(req), returnHeaders: true }),
      ),

    signInEmail: (
      req: FastifyRequest,
      reply: FastifyReply,
      body: { email: string; password: string },
    ) =>
      session(
        req,
        reply,
        auth.api.signInEmail({ body, headers: toFetchHeaders(req), returnHeaders: true }),
      ),

    async requestOtp(req: FastifyRequest, phone: string) {
      await auth.api.sendPhoneNumberOTP({
        body: { phoneNumber: phone },
        headers: toFetchHeaders(req),
      });
    },

    verifyOtp: (req: FastifyRequest, reply: FastifyReply, body: { phone: string; code: string }) =>
      session(
        req,
        reply,
        auth.api.verifyPhoneNumber({
          body: { phoneNumber: body.phone, code: body.code },
          headers: toFetchHeaders(req),
          returnHeaders: true,
        }) as Promise<{ headers: Headers; response: { token: string | null; user: AuthUserLike } }>,
      ),

    async signOut(req: FastifyRequest, reply: FastifyReply) {
      const { headers } = await auth.api.signOut({
        headers: toFetchHeaders(req),
        returnHeaders: true,
      });
      forwardAuthHeaders(headers, reply);
    },

    async forgotPassword(email: string) {
      // Same answer whether or not the account exists (no account enumeration).
      await auth.api
        .requestPasswordReset({
          body: { email, redirectTo: `${config.domain.webUrl}/reset-password` },
        })
        .catch(() => undefined);
    },

    async resetPassword(body: { token: string; newPassword: string }) {
      await auth.api.resetPassword({ body });
    },

    me,

    async setActiveOrg(req: FastifyRequest, orgId: string) {
      const list = await memberships(req.actor!.userId);
      if (!list.some((m) => m.orgId === orgId))
        throw AppError.forbidden('You are not a member of that organization.');
      await auth.api.setActiveOrganization({
        body: { organizationId: orgId },
        headers: toFetchHeaders(req),
      });
      req.actor = { ...req.actor!, orgId, role: list.find((m) => m.orgId === orgId)!.role };
      return me(req);
    },

    async createOrg(req: FastifyRequest, body: z.infer<typeof CreateOrgBody>): Promise<OrgDto> {
      const userId = req.actor!.userId;
      const slug = `${slugify(body.name)}-${crypto.randomUUID().slice(0, 6)}`;
      const org = await auth.api.createOrganization({
        body: { name: body.name, slug, kind: body.kind },
        headers: toFetchHeaders(req),
      });
      if (!org) throw new AppError(500, 'org_not_created', 'Organization not created');
      try {
        await withTenant(db, { orgId: org.id, userId }, async (tx) => {
          await tx.insert(schema.orgProfile).values({
            orgId: org.id,
            kraPin: body.kraPin ?? null,
            phone: body.phone ?? null,
            email: body.email ?? null,
            county: body.county ?? null,
          });
          for (const hook of hooks.orgCreated)
            await hook(tx, { orgId: org.id, name: body.name, kind: body.kind, userId });
          await tx.insert(schema.auditLog).values({
            orgId: org.id,
            actorKind: 'user',
            actorUserId: userId,
            action: 'org.created',
            entityType: 'organization',
            entityId: org.id,
            requestId: req.id,
          });
        });
      } catch (err) {
        // Better Auth committed the org in its own transaction; undo it so no half-made org remains.
        await db.owner.delete(schema.organization).where(eq(schema.organization.id, org.id));
        throw err;
      }
      req.actor = { ...req.actor!, orgId: org.id, role: 'owner' };
      return loadOrg(req, org.id);
    },

    getOrg: (req: FastifyRequest) => loadOrg(req, req.actor!.orgId!),

    async updateOrg(req: FastifyRequest, body: z.infer<typeof UpdateOrgBody>): Promise<OrgDto> {
      const orgId = req.actor!.orgId!;
      if (body.name) {
        await db.owner
          .update(schema.organization)
          .set({ name: body.name })
          .where(eq(schema.organization.id, orgId));
      }
      const { name: _name, ...profile } = body;
      await req.tenant(async (tx) => {
        if (Object.keys(profile).length) {
          await tx
            .insert(schema.orgProfile)
            .values({ orgId, ...profile })
            .onConflictDoUpdate({ target: schema.orgProfile.orgId, set: profile });
        }
        await audit(tx, req, {
          action: 'org.updated',
          entityType: 'organization',
          entityId: orgId,
          diff: body,
        });
      });
      return loadOrg(req, orgId);
    },

    async listMembers(req: FastifyRequest): Promise<z.infer<typeof Member>[]> {
      const rows = await db.owner
        .select({ m: schema.member, u: schema.user })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, req.actor!.orgId!))
        .orderBy(schema.member.createdAt);
      return rows.map(({ m, u }) => {
        const user = toUser(u);
        return {
          id: m.id,
          userId: u.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: m.role,
          createdAt: iso(m.createdAt),
        };
      });
    },

    /** user ids → role, for other modules validating staff assignments. */
    async memberRoles(orgId: string, userIds: string[]): Promise<Map<string, Role>> {
      if (!userIds.length) return new Map();
      const rows = await db.owner
        .select({ userId: schema.member.userId, role: schema.member.role })
        .from(schema.member)
        .where(
          and(eq(schema.member.organizationId, orgId), inArray(schema.member.userId, userIds)),
        );
      return new Map(rows.map((r) => [r.userId, r.role]));
    },

    async updateMemberRole(req: FastifyRequest, memberId: string, role: Role) {
      const orgId = req.actor!.orgId!;
      const target = await memberOf(orgId, memberId);
      if (target.role === role) return;
      if (target.role === 'owner' && (await ownerCount(orgId)) <= 1) {
        throw AppError.conflict('last_owner', 'An organization must keep at least one owner.');
      }
      await auth.api.updateMemberRole({
        body: { memberId, role, organizationId: orgId },
        headers: toFetchHeaders(req),
      });
      await req.tenant((tx) =>
        audit(tx, req, {
          action: 'member.role_changed',
          entityType: 'member',
          entityId: memberId,
          diff: { from: target.role, to: role },
        }),
      );
    },

    async removeMember(req: FastifyRequest, memberId: string) {
      const actor = req.actor!;
      const orgId = actor.orgId!;
      const target = await memberOf(orgId, memberId);
      if (target.userId === actor.userId)
        throw AppError.conflict('cannot_remove_self', 'You cannot remove yourself.');
      if (!grantableRoles(actor.role!).includes(target.role)) {
        throw AppError.forbidden(`A ${actor.role} cannot remove a ${target.role}.`);
      }
      if (target.role === 'owner' && (await ownerCount(orgId)) <= 1) {
        throw AppError.conflict('last_owner', 'An organization must keep at least one owner.');
      }
      await auth.api.removeMember({
        body: { memberIdOrEmail: memberId, organizationId: orgId },
        headers: toFetchHeaders(req),
      });
      await req.tenant(async (tx) => {
        for (const hook of hooks.memberRemoved) await hook(tx, target.userId);
        await audit(tx, req, {
          action: 'member.removed',
          entityType: 'member',
          entityId: memberId,
          diff: { userId: target.userId, role: target.role },
        });
      });
    },

    async createInvitation(req: FastifyRequest, body: z.infer<typeof CreateInvitationBody>) {
      const actor = req.actor!;
      const orgId = actor.orgId!;
      if (Boolean(body.email) === Boolean(body.phone)) {
        throw AppError.unprocessable(
          'email_or_phone',
          'Provide either an email or a phone number (not both).',
        );
      }
      if (!grantableRoles(actor.role!).includes(body.role)) {
        throw AppError.forbidden(`A ${actor.role} cannot invite a ${body.role}.`);
      }
      const email = body.email ?? phoneEmail(body.phone!);
      const created = await auth.api.createInvitation({
        body: { email, role: body.role, organizationId: orgId },
        headers: toFetchHeaders(req),
      });
      const [org] = await db.owner
        .select({ name: schema.organization.name })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId));
      const inviter = await loadUser(actor.userId);
      const orgName = org?.name ?? '';
      await req.tenant(async (tx) => {
        await enqueueInTx(
          tx,
          body.phone
            ? {
                orgId,
                topic: 'notifications.sms',
                payload: invitationSms(config, { to: body.phone, orgName, role: body.role }),
              }
            : {
                orgId,
                topic: 'notifications.email',
                payload: invitationEmail(config, {
                  to: email,
                  orgName,
                  inviterName: inviter.name,
                  role: body.role,
                  invitationId: created.id,
                }),
              },
        );
        await audit(tx, req, {
          action: 'invitation.created',
          entityType: 'invitation',
          entityId: created.id,
          diff: { role: body.role, channel: body.phone ? 'sms' : 'email' },
        });
      });
      const [row] = await db.owner
        .select()
        .from(schema.invitation)
        .where(eq(schema.invitation.id, created.id));
      return toInvitation(row!, orgName);
    },

    async listInvitations(req: FastifyRequest) {
      const orgId = req.actor!.orgId!;
      const rows = await db.owner
        .select({ i: schema.invitation, orgName: schema.organization.name })
        .from(schema.invitation)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.invitation.organizationId),
        )
        .where(
          and(
            eq(schema.invitation.organizationId, orgId),
            eq(schema.invitation.status, 'pending'),
            gt(schema.invitation.expiresAt, sql`now()`),
          ),
        )
        .orderBy(schema.invitation.createdAt);
      return rows.map((r) => toInvitation(r.i, r.orgName));
    },

    async myInvitations(req: FastifyRequest) {
      const user = await db.owner
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, req.actor!.userId));
      const email = user[0]?.email;
      if (!email) return [];
      const rows = await db.owner
        .select({ i: schema.invitation, orgName: schema.organization.name })
        .from(schema.invitation)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.invitation.organizationId),
        )
        .where(
          and(
            sql`lower(${schema.invitation.email}) = lower(${email})`,
            eq(schema.invitation.status, 'pending'),
            gt(schema.invitation.expiresAt, sql`now()`),
          ),
        );
      return rows.map((r) => toInvitation(r.i, r.orgName));
    },

    async cancelInvitation(req: FastifyRequest, invitationId: string) {
      const orgId = req.actor!.orgId!;
      const [row] = await db.owner
        .select()
        .from(schema.invitation)
        .where(
          and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organizationId, orgId)),
        );
      if (!row) throw AppError.notFound('Invitation');
      await auth.api.cancelInvitation({ body: { invitationId }, headers: toFetchHeaders(req) });
      await req.tenant((tx) =>
        audit(tx, req, {
          action: 'invitation.canceled',
          entityType: 'invitation',
          entityId: invitationId,
        }),
      );
    },

    async acceptInvitation(req: FastifyRequest, invitationId: string) {
      const accepted = await auth.api.acceptInvitation({
        body: { invitationId },
        headers: toFetchHeaders(req),
      });
      const orgId = accepted?.member.organizationId;
      if (!orgId) throw AppError.notFound('Invitation');
      // Make the joined org active so the next call works without an extra step.
      await auth.api.setActiveOrganization({
        body: { organizationId: orgId },
        headers: toFetchHeaders(req),
      });
      const role = accepted.member.role;
      req.actor = { ...req.actor!, orgId, role: isRole(role) ? role : undefined };
      await req.tenant((tx) =>
        audit(tx, req, {
          action: 'invitation.accepted',
          entityType: 'invitation',
          entityId: invitationId,
        }),
      );
      return me(req);
    },
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}
