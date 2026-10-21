/**
 * Contract rules generated clients depend on (ADR-002, ADR-017). Fails CI on any violation.
 *  1. Every operation has a unique operationId.
 *  2. Every `*Cents` property is `integer` with `format: int64` (Kotlin Long, never Double).
 *  3. Every JSON request body and response is a named component ($ref), so clients get named types.
 *  4. Every write operation documents a ProblemDetails 4xx response.
 */
import { readFileSync } from 'node:fs';

type Json = Record<string, unknown>;
const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as Json;
const errors: string[] = [];

const ops: { id: string; method: string; path: string; op: Json }[] = [];
for (const [path, item] of Object.entries((spec.paths ?? {}) as Record<string, Json>)) {
  for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    ops.push({ id: `${method.toUpperCase()} ${path}`, method, path, op: op as Json });
  }
}

const seen = new Map<string, string>();
for (const { id, op } of ops) {
  const operationId = op.operationId as string | undefined;
  if (!operationId) errors.push(`${id}: missing operationId`);
  else if (seen.has(operationId))
    errors.push(`${id}: operationId "${operationId}" also used by ${seen.get(operationId)}`);
  else seen.set(operationId, id);
}

function walk(node: unknown, where: string): void {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
  if (!node || typeof node !== 'object') return;
  const obj = node as Json;
  if (obj.properties && typeof obj.properties === 'object') {
    for (const [name, prop] of Object.entries(obj.properties as Record<string, Json>)) {
      if (
        /Cents$/.test(name) &&
        !('$ref' in prop) &&
        (prop.type !== 'integer' || prop.format !== 'int64')
      ) {
        errors.push(
          `${where}.${name}: *Cents must be integer/int64 (got ${String(prop.type)}/${String(prop.format)})`,
        );
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) walk(v, `${where}.${k}`);
}
walk(spec.components, 'components');
walk(spec.paths, 'paths');

const jsonSchemaOf = (content: unknown) =>
  (content as Json | undefined)?.['application/json'] as Json | undefined;
for (const { id, method, op } of ops) {
  const body = jsonSchemaOf((op.requestBody as Json | undefined)?.content);
  if (body && !(body.schema as Json | undefined)?.$ref)
    errors.push(`${id}: request body must be a named schema ($ref)`);

  const responses = (op.responses ?? {}) as Record<string, Json>;
  for (const [status, res] of Object.entries(responses)) {
    const media = jsonSchemaOf(res.content);
    const schema = media?.schema as Json | undefined;
    if (schema && !schema.$ref)
      errors.push(`${id} → ${status}: response must be a named schema ($ref)`);
  }
  if (method !== 'get') {
    const has4xx = Object.entries(responses).some(
      ([s, r]) =>
        s.startsWith('4') &&
        String((jsonSchemaOf(r.content)?.schema as Json | undefined)?.$ref ?? '').endsWith(
          '/ProblemDetails',
        ),
    );
    if (!has4xx) errors.push(`${id}: write operations must document a ProblemDetails 4xx response`);
  }
}

if (errors.length) {
  console.error(`Spec lint failed (${errors.length}):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Spec lint passed: ${ops.length} operations.`);
