import { describe, expect, it } from 'vitest';
import { ConfigError, darajaCallbackBase, loadConfig } from './index';

const base = {
  DATABASE_URL: 'postgresql://o@h/db',
  DATABASE_AUTHENTICATED_URL: 'postgresql://a@h/db',
  REDIS_URL: 'redis://h:6379',
};
// Built from parts so this file never contains a literal production-like domain.
const domain = ['example', 'co', 'ke'].join('.');

describe('loadConfig', () => {
  it('derives every URL from APP_DOMAIN', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', APP_DOMAIN: domain });
    expect(c.domain.apiUrl).toBe(`https://api.${domain}`);
    expect(c.domain.webUrl).toBe(`https://app.${domain}`);
    expect(c.domain.cookieDomain).toBe(`.${domain}`);
    expect(c.domain.emailFrom).toBe(`no-reply@${domain}`);
    expect(c.domain.trustedOrigins).toEqual([`https://app.${domain}`]);
    expect(c.auth.url).toBe(`https://api.${domain}`);
    expect(darajaCallbackBase(c, 'tok_1')).toBe(`https://api.${domain}/v1/payments/daraja/tok_1`);
  });

  it('uses localhost defaults with host-only cookies', () => {
    const c = loadConfig({ ...base, APP_DOMAIN: 'localhost', API_PORT: '4100' });
    expect(c.domain.apiUrl).toBe('http://localhost:4100');
    expect(c.domain.webUrl).toBe('http://localhost:3000');
    expect(c.domain.cookieDomain).toBeUndefined();
  });

  it('honours explicit overrides and legacy domains', () => {
    const c = loadConfig({
      ...base,
      APP_DOMAIN: domain,
      API_URL: 'https://staging-api.test/',
      LEGACY_DOMAINS: 'old.test, older.test',
    });
    expect(c.domain.apiUrl).toBe('https://staging-api.test');
    expect(c.domain.trustedOrigins).toEqual([
      `https://app.${domain}`,
      'https://app.old.test',
      'https://app.older.test',
    ]);
  });

  it('fails fast on invalid env', () => {
    expect(() => loadConfig({ APP_DOMAIN: 'localhost' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, APP_DOMAIN: 'https://bad' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_DOMAIN: 'localhost' })).toThrow(
      ConfigError,
    );
  });
});
