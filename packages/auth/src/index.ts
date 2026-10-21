export { createAuth, OTP_TTL_SECONDS, SESSION_TTL_SECONDS, type Auth, type AuthDeps } from './auth';
export { isPhoneEmail, phoneEmail, phoneFromPhoneEmail } from './phone-email';
export { grantableRoles, hasRole, isRole, ROLES, type Role } from './roles';
export { APIError } from 'better-auth/api';
