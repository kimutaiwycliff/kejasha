/* global __ENV, __VU, __ITER */
// Load test (B7): 50 virtual users on a realistic mix; P95 must stay under 500 ms.
//   make load-test [API_BASE=http://host.docker.internal:4000] [DURATION=2m]
// Uses the seeded demo landlord (make db-seed). Run against a production-like build, not dev mode.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.API_BASE || 'http://host.docker.internal:4000';
const PERIOD = new Date().toISOString().slice(0, 7);

export const options = {
  scenarios: {
    office: { executor: 'constant-vus', vus: 50, duration: __ENV.DURATION || '2m' },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    // Per endpoint, so the summary shows where time goes.
    ...Object.fromEntries(
      [
        'dashboard',
        'units',
        'leases',
        'payments',
        'tenants',
        'statements',
        'rent-roll',
        'arrears',
        'tickets',
        'sync-pull',
        'create-ticket',
      ].map((n) => [`http_req_duration{name:${n}}`, ['p(95)<500']]),
    ),
  },
};

export function setup() {
  const res = http.post(
    `${BASE}/v1/identity/sign-in/email`,
    JSON.stringify({ email: 'landlord@demo.test', password: 'demo-password-123' }),
    { headers: { 'content-type': 'application/json' } },
  );
  check(res, { 'signed in': (r) => r.status === 200 });
  const token = res.json('token');
  // A new session has no active organization yet: pick the demo landlord's.
  const auth = {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  };
  const me = http.get(`${BASE}/v1/identity/me`, auth);
  const orgs = me.json('memberships') || [];
  const orgId = (orgs.find((m) => m.orgName === 'Wanjiku Homes') || orgs[0]).orgId;
  check(http.post(`${BASE}/v1/identity/active-org`, JSON.stringify({ orgId }), auth), {
    'org selected': (r) => r.status === 200,
  });
  const units = http.get(`${BASE}/v1/units?limit=50`, {
    headers: { authorization: `Bearer ${token}` },
  });
  // Idempotency keys must be unique per run: a reused key with a new body is (rightly) a 422.
  return { token, run: Date.now(), unitIds: (units.json('items') || []).map((u) => u.id) };
}

const READS = [
  [`/v1/reports/owner-dashboard?period=${PERIOD}`, 'dashboard'],
  ['/v1/units?limit=25', 'units'],
  ['/v1/leases?limit=25', 'leases'],
  ['/v1/payments?limit=25', 'payments'],
  ['/v1/tenants?limit=25', 'tenants'],
  [`/v1/owner-statements?period=${PERIOD}`, 'statements'],
  ['/v1/reports/rent-roll', 'rent-roll'],
  ['/v1/arrears', 'arrears'],
  ['/v1/tickets?limit=25', 'tickets'],
  ['/v1/sync/pull', 'sync-pull'],
];

export default function (data) {
  const headers = { authorization: `Bearer ${data.token}` };
  for (let i = 0; i < 4; i++) {
    const [path, name] = READS[Math.floor(Math.random() * READS.length)];
    const r = http.get(`${BASE}${path}`, { headers, tags: { name } });
    check(r, { [`${name} 200`]: (x) => x.status === 200 });
    sleep(Math.random() * 0.5);
  }
  // One write in ten iterations: a maintenance ticket (idempotent).
  if (Math.random() < 0.1 && data.unitIds.length) {
    const unitId = data.unitIds[Math.floor(Math.random() * data.unitIds.length)];
    const r = http.post(
      `${BASE}/v1/tickets`,
      JSON.stringify({ unitId, title: 'Load test ticket', category: 'other' }),
      {
        headers: {
          ...headers,
          'content-type': 'application/json',
          'idempotency-key': `load-${data.run}-${__VU}-${__ITER}`,
        },
        tags: { name: 'create-ticket' },
      },
    );
    check(r, { 'ticket 201': (x) => x.status === 201 });
  }
  sleep(1);
}
