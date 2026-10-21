import { expect, it } from 'vitest';
import { phoneEmail, phoneFromPhoneEmail } from './phone-email';
import { grantableRoles, hasRole } from './roles';

it('ranks roles owner > manager > agent > caretaker', () => {
  expect(hasRole('owner', 'manager')).toBe(true);
  expect(hasRole('manager', 'manager')).toBe(true);
  expect(hasRole('agent', 'manager')).toBe(false);
  expect(hasRole('caretaker', 'agent')).toBe(false);
});

it('managers cannot grant owner', () => {
  expect(grantableRoles('manager')).not.toContain('owner');
  expect(grantableRoles('owner')).toContain('owner');
  expect(grantableRoles('agent')).toEqual([]);
});

it('phone placeholder emails round-trip', () => {
  expect(phoneEmail('+254712345678')).toBe('254712345678@phone.invalid');
  expect(phoneFromPhoneEmail('254712345678@phone.invalid')).toBe('+254712345678');
  expect(phoneFromPhoneEmail('a@b.test')).toBeNull();
});
