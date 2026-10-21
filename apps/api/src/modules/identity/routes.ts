import {
  Accepted,
  AuthSession,
  CreateInvitationBody,
  CreateOrgBody,
  ForgotPasswordBody,
  IdParam,
  Invitation,
  InvitationList,
  Me,
  MemberList,
  Org,
  OtpRequestBody,
  OtpRequestResult,
  OtpVerifyBody,
  problemResponses,
  ResetPasswordBody,
  SetActiveOrgBody,
  SignInEmailBody,
  SignUpEmailBody,
  UpdateMemberBody,
  UpdateOrgBody,
} from '@kejasha/contracts';
import { OTP_TTL_SECONDS } from '@kejasha/auth';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { hitLimit } from '../../lib/rate-limit';
import type { IdentityService } from './service';

const NoContent = z.undefined();

export function identityRoutes(identity: IdentityService): FastifyPluginAsyncZod<AppDeps> {
  return async (app, deps) => {
    const tags = ['identity'];

    // ── Sessions ───────────────────────────────────────────────────────────────────────────
    app.post(
      '/v1/identity/sign-up/email',
      {
        config: { auth: 'public' },
        schema: {
          operationId: 'signUpEmail',
          tags,
          summary: 'Create an account with email and password',
          body: SignUpEmailBody,
          response: { 200: AuthSession, ...problemResponses(409, 422, 429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `signup:ip:${req.ip}`, 20, 3600);
        return identity.signUpEmail(req, reply, req.body);
      },
    );

    app.post(
      '/v1/identity/sign-in/email',
      {
        config: { auth: 'public' },
        schema: {
          operationId: 'signInEmail',
          tags,
          summary: 'Sign in with email and password',
          description: 'Sets the session cookie (web) and returns a bearer token (mobile).',
          body: SignInEmailBody,
          response: { 200: AuthSession, ...problemResponses(401, 429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `signin:ip:${req.ip}`, 30, 600);
        await hitLimit(deps.redis, `signin:email:${req.body.email}`, 10, 600);
        return identity.signInEmail(req, reply, req.body);
      },
    );

    app.post(
      '/v1/identity/otp/request',
      {
        config: { auth: 'public' },
        schema: {
          operationId: 'requestPhoneOtp',
          tags,
          summary: 'Send a sign-in code by SMS',
          description: 'Works for new and existing phone numbers. Limited per phone and per IP.',
          body: OtpRequestBody,
          response: { 202: OtpRequestResult, ...problemResponses(429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `otp:phone:${req.body.phone}`, 5, 900);
        await hitLimit(deps.redis, `otp:ip:${req.ip}`, 30, 900);
        await identity.requestOtp(req, req.body.phone);
        return reply.status(202).send({ expiresInSeconds: OTP_TTL_SECONDS });
      },
    );

    app.post(
      '/v1/identity/otp/verify',
      {
        config: { auth: 'public' },
        schema: {
          operationId: 'verifyPhoneOtp',
          tags,
          summary: 'Verify an SMS code and sign in',
          description: 'Creates the account on first sign-in.',
          body: OtpVerifyBody,
          response: { 200: AuthSession, ...problemResponses(401, 429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `otp-verify:phone:${req.body.phone}`, 10, 900);
        return identity.verifyOtp(req, reply, req.body);
      },
    );

    app.post(
      '/v1/identity/sign-out',
      {
        config: { auth: 'user' },
        schema: {
          operationId: 'signOut',
          tags,
          summary: 'End the current session',
          response: { 204: NoContent, ...problemResponses() },
        },
      },
      async (req, reply) => {
        await identity.signOut(req, reply);
        return reply.status(204).send();
      },
    );

    app.post(
      '/v1/identity/password/forgot',
      {
        config: { auth: 'public' },
        schema: {
          operationId: 'forgotPassword',
          tags,
          summary: 'Email a password reset link',
          description: 'Always answers 202, whether or not the email has an account.',
          body: ForgotPasswordBody,
          response: { 202: Accepted, ...problemResponses(429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `forgot:email:${req.body.email}`, 3, 3600);
        await identity.forgotPassword(req.body.email);
        return reply.status(202).send({ ok: true });
      },
    );

    app.post(
      '/v1/identity/password/reset',
      {
        config: { auth: 'public' },
        schema: {
          operationId: 'resetPassword',
          tags,
          summary: 'Set a new password with a reset token',
          body: ResetPasswordBody,
          response: { 204: NoContent, ...problemResponses(401, 429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `reset:ip:${req.ip}`, 10, 900);
        await identity.resetPassword(req.body);
        return reply.status(204).send();
      },
    );

    app.get(
      '/v1/identity/me',
      {
        config: { auth: 'user' },
        schema: {
          operationId: 'getMe',
          tags,
          summary: 'Current user, memberships and active org',
          response: { 200: Me, ...problemResponses() },
        },
      },
      async (req) => identity.me(req),
    );

    app.post(
      '/v1/identity/active-org',
      {
        config: { auth: 'user' },
        schema: {
          operationId: 'setActiveOrg',
          tags,
          summary: 'Switch the active organization',
          body: SetActiveOrgBody,
          response: { 200: Me, ...problemResponses() },
        },
      },
      async (req) => identity.setActiveOrg(req, req.body.orgId),
    );

    // ── Organization ───────────────────────────────────────────────────────────────────────
    app.post(
      '/v1/orgs',
      {
        config: { auth: 'user' },
        schema: {
          operationId: 'createOrg',
          tags,
          summary: 'Create an organization (you become its owner and it becomes active)',
          body: CreateOrgBody,
          response: { 201: Org, ...problemResponses(409) },
        },
      },
      async (req, reply) => reply.status(201).send(await identity.createOrg(req, req.body)),
    );

    app.get(
      '/v1/org',
      {
        schema: {
          operationId: 'getOrg',
          tags,
          summary: 'The active organization',
          response: { 200: Org, ...problemResponses() },
        },
      },
      async (req) => identity.getOrg(req),
    );

    app.patch(
      '/v1/org',
      {
        config: { minRole: 'manager' },
        schema: {
          operationId: 'updateOrg',
          tags,
          summary: 'Update the active organization',
          body: UpdateOrgBody,
          response: { 200: Org, ...problemResponses() },
        },
      },
      async (req) => identity.updateOrg(req, req.body),
    );

    // ── Members ────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/members',
      {
        schema: {
          operationId: 'listMembers',
          tags,
          summary: 'Members of the active organization',
          response: { 200: MemberList, ...problemResponses() },
        },
      },
      async (req) => ({ items: await identity.listMembers(req) }),
    );

    app.patch(
      '/v1/members/:id',
      {
        config: { minRole: 'owner' },
        schema: {
          operationId: 'updateMemberRole',
          tags,
          summary: "Change a member's role (owners only)",
          params: IdParam,
          body: UpdateMemberBody,
          response: { 200: MemberList, ...problemResponses(404, 409) },
        },
      },
      async (req) => {
        await identity.updateMemberRole(req, req.params.id, req.body.role);
        return { items: await identity.listMembers(req) };
      },
    );

    app.delete(
      '/v1/members/:id',
      {
        config: { minRole: 'manager' },
        schema: {
          operationId: 'removeMember',
          tags,
          summary: 'Remove a member',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404, 409) },
        },
      },
      async (req, reply) => {
        await identity.removeMember(req, req.params.id);
        return reply.status(204).send();
      },
    );

    // ── Invitations ────────────────────────────────────────────────────────────────────────
    app.post(
      '/v1/invitations',
      {
        config: { minRole: 'manager' },
        schema: {
          operationId: 'createInvitation',
          tags,
          summary: 'Invite someone by email or phone (SMS)',
          body: CreateInvitationBody,
          response: { 201: Invitation, ...problemResponses(409, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await identity.createInvitation(req, req.body)),
    );

    app.get(
      '/v1/invitations',
      {
        config: { minRole: 'manager' },
        schema: {
          operationId: 'listInvitations',
          tags,
          summary: 'Pending invitations of the active organization',
          response: { 200: InvitationList, ...problemResponses() },
        },
      },
      async (req) => ({ items: await identity.listInvitations(req) }),
    );

    app.get(
      '/v1/identity/me/invitations',
      {
        config: { auth: 'user' },
        schema: {
          operationId: 'listMyInvitations',
          tags,
          summary: 'Pending invitations for the signed-in user',
          response: { 200: InvitationList, ...problemResponses() },
        },
      },
      async (req) => ({ items: await identity.myInvitations(req) }),
    );

    app.delete(
      '/v1/invitations/:id',
      {
        config: { minRole: 'manager' },
        schema: {
          operationId: 'cancelInvitation',
          tags,
          summary: 'Cancel a pending invitation',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404) },
        },
      },
      async (req, reply) => {
        await identity.cancelInvitation(req, req.params.id);
        return reply.status(204).send();
      },
    );

    app.post(
      '/v1/invitations/:id/accept',
      {
        config: { auth: 'user' },
        schema: {
          operationId: 'acceptInvitation',
          tags,
          summary: 'Accept an invitation (the org becomes active)',
          params: IdParam,
          response: { 200: Me, ...problemResponses(404) },
        },
      },
      async (req) => identity.acceptInvitation(req, req.params.id),
    );
  };
}
