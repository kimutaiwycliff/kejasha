import { z } from 'zod';

/**
 * Runtime configuration. `APP_DOMAIN` is the only place the domain lives (ADR-016); every URL,
 * origin, cookie domain and sender is derived from it unless explicitly overridden.
 */
const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_DOMAIN: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+$/i, 'APP_DOMAIN must be a bare host name, e.g. example.co.ke'),
  API_URL: optionalString.pipe(z.url().optional()),
  WEB_URL: optionalString.pipe(z.url().optional()),
  LEGACY_DOMAINS: csv,
  API_PORT: z.coerce.number().int().positive().default(4000),
  // Which proxies may set X-Forwarded-For. Never `true` in production (clients could spoof their
  // IP and dodge rate limits): use the hop count or proxy CIDRs, e.g. "2" for Cloudflare → Caddy.
  TRUST_PROXY: z.string().default('loopback'),

  DATABASE_URL: z.string().min(1),
  DATABASE_AUTHENTICATED_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: optionalString,
  CREDENTIALS_MASTER_KEY: optionalString,

  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  S3_BUCKET_FILES: z.string().default('kejasha-files'),
  S3_BUCKET_BACKUPS: z.string().default('kejasha-backups'),

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,

  AFRICASTALKING_API_KEY: optionalString,
  AFRICASTALKING_USERNAME: z.string().default('sandbox'),
  AFRICASTALKING_SENDER_ID: optionalString,
  AFRICASTALKING_WHATSAPP_CHANNEL: optionalString,

  DARAJA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  // Optional allowlist of Safaricom callback source IPs (comma-separated). Empty = accept any.
  DARAJA_CALLBACK_IPS: csv,
  // Off only in tests that are not about billing: unpaid orgs may then write. Refused in production.
  BILLING_REQUIRED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Sync pull stays this far behind now() so rows of still-open transactions are not skipped.
  SYNC_LAG_SECONDS: z.coerce.number().int().min(0).max(300).default(10),
  // Tests only: let iCal feeds point at local servers. Refused in production (SSRF guard).
  ICAL_ALLOW_PRIVATE_HOSTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PAYSTACK_SECRET_KEY: optionalString,
  PAYSTACK_PUBLIC_KEY: optionalString,

  CRON_SECRET: optionalString,
  GLITCHTIP_DSN: optionalString,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  logLevel: Env['LOG_LEVEL'];
  domain: {
    appDomain: string;
    legacyDomains: string[];
    apiUrl: string;
    webUrl: string;
    /** Origins allowed by CORS / Better Auth trusted origins. */
    trustedOrigins: string[];
    /** `.example.co.ke` in deployed envs; undefined on localhost (host-only cookies). */
    cookieDomain: string | undefined;
    emailFrom: string;
  };
  api: { port: number; trustProxy: boolean | number | string };
  db: { ownerUrl: string; authenticatedUrl: string };
  redis: { url: string };
  auth: { secret: string | undefined; url: string };
  credentialsMasterKey: string | undefined;
  s3: {
    endpoint: string | undefined;
    region: string;
    accessKey: string | undefined;
    secretKey: string | undefined;
    bucketFiles: string;
    bucketBackups: string;
  };
  email: { resendApiKey: string | undefined };
  africasTalking: {
    apiKey: string | undefined;
    username: string;
    senderId: string | undefined;
    whatsappChannel: string | undefined;
  };
  daraja: { env: 'sandbox' | 'production'; callbackIps: string[] };
  ical: { allowPrivateHosts: boolean };
  sync: { lagSeconds: number };
  billing: { required: boolean };
  paystack: { secretKey: string | undefined; publicKey: string | undefined };
  cronSecret: string | undefined;
  observability: { glitchtipDsn: string | undefined; otlpEndpoint: string | undefined };
}

const isLocal = (domain: string) => domain === 'localhost' || domain.endsWith('.localhost');

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const local = isLocal(e.APP_DOMAIN);
  const apiUrl = stripSlash(
    e.API_URL ?? (local ? `http://localhost:${e.API_PORT}` : `https://api.${e.APP_DOMAIN}`),
  );
  const webUrl = stripSlash(
    e.WEB_URL ?? (local ? 'http://localhost:3000' : `https://app.${e.APP_DOMAIN}`),
  );
  const legacyOrigins = e.LEGACY_DOMAINS.map((d) => `https://app.${d}`);

  if (e.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (local) missing.push('APP_DOMAIN: must be a real domain in production');
    if (!apiUrl.startsWith('https://')) missing.push('API_URL: must be https in production');
    if (e.ICAL_ALLOW_PRIVATE_HOSTS)
      missing.push('ICAL_ALLOW_PRIVATE_HOSTS: must be false in production');
    if (!e.BILLING_REQUIRED) missing.push('BILLING_REQUIRED: must be true in production');
    if (e.TRUST_PROXY === 'true')
      missing.push('TRUST_PROXY: must be a hop count or CIDRs in production, not true');
    if (!e.BETTER_AUTH_SECRET || e.BETTER_AUTH_SECRET.length < 32) {
      missing.push('BETTER_AUTH_SECRET: required (32+ chars) in production');
    }
    if (missing.length) throw new ConfigError(missing);
  }

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    logLevel: e.LOG_LEVEL,
    domain: {
      appDomain: e.APP_DOMAIN,
      legacyDomains: e.LEGACY_DOMAINS,
      apiUrl,
      webUrl,
      trustedOrigins: [...new Set([webUrl, ...legacyOrigins])],
      cookieDomain: local ? undefined : `.${e.APP_DOMAIN}`,
      emailFrom: e.EMAIL_FROM ?? `no-reply@${local ? 'localhost' : e.APP_DOMAIN}`,
    },
    api: { port: e.API_PORT, trustProxy: parseTrustProxy(e.TRUST_PROXY) },
    db: { ownerUrl: e.DATABASE_URL, authenticatedUrl: e.DATABASE_AUTHENTICATED_URL },
    redis: { url: e.REDIS_URL },
    auth: { secret: e.BETTER_AUTH_SECRET, url: stripSlash(e.BETTER_AUTH_URL ?? apiUrl) },
    credentialsMasterKey: e.CREDENTIALS_MASTER_KEY,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      bucketFiles: e.S3_BUCKET_FILES,
      bucketBackups: e.S3_BUCKET_BACKUPS,
    },
    email: { resendApiKey: e.RESEND_API_KEY },
    africasTalking: {
      apiKey: e.AFRICASTALKING_API_KEY,
      username: e.AFRICASTALKING_USERNAME,
      senderId: e.AFRICASTALKING_SENDER_ID,
      whatsappChannel: e.AFRICASTALKING_WHATSAPP_CHANNEL,
    },
    daraja: { env: e.DARAJA_ENV, callbackIps: e.DARAJA_CALLBACK_IPS },
    ical: { allowPrivateHosts: e.ICAL_ALLOW_PRIVATE_HOSTS },
    sync: { lagSeconds: e.SYNC_LAG_SECONDS },
    billing: { required: e.BILLING_REQUIRED },
    paystack: { secretKey: e.PAYSTACK_SECRET_KEY, publicKey: e.PAYSTACK_PUBLIC_KEY },
    cronSecret: e.CRON_SECRET,
    observability: { glitchtipDsn: e.GLITCHTIP_DSN, otlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT },
  };
}

function parseTrustProxy(v: string): boolean | number | string {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // 'loopback', CIDR list, …
}

/** Daraja callback base for a payment channel (ADR-008/016). */
export function darajaCallbackBase(config: Config, channelToken: string): string {
  return `${config.domain.apiUrl}/v1/payments/daraja/${encodeURIComponent(channelToken)}`;
}
