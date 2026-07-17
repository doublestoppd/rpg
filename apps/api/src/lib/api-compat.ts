/**
 * OpenAPI compatibility checking (Phase 13B). The shared Zod schemas remain
 * the authoritative contract (ADR 0002); the generated OpenAPI document is
 * treated as a serialized snapshot of that contract so accidental breaking
 * changes fail a test instead of shipping. Additions are always allowed —
 * only removals and mutations of what the baseline promised are violations.
 */

interface OpenApiLike {
  paths?: Record<string, Record<string, unknown>>;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively verifies `current` still honors everything `baseline`
 * promised: object properties may not disappear, enums may not change,
 * types may not change, and required response fields stay required.
 */
function compareSchemas(
  baseline: unknown,
  current: unknown,
  where: string,
  violations: string[],
): void {
  if (!isRecord(baseline)) return;
  if (!isRecord(current)) {
    violations.push(`${where}: schema was removed or replaced`);
    return;
  }

  if (typeof baseline['type'] === 'string' && typeof current['type'] === 'string') {
    if (baseline['type'] !== current['type']) {
      violations.push(`${where}: type changed ${baseline['type']} -> ${current['type']}`);
    }
  }

  if (Array.isArray(baseline['enum'])) {
    const baseEnum = [...(baseline['enum'] as unknown[])].sort();
    const currentEnum = Array.isArray(current['enum'])
      ? [...(current['enum'] as unknown[])].sort()
      : [];
    if (JSON.stringify(baseEnum) !== JSON.stringify(currentEnum)) {
      violations.push(`${where}: enum changed`);
    }
  }

  if (Array.isArray(baseline['required'])) {
    const currentRequired = new Set(
      Array.isArray(current['required']) ? (current['required'] as string[]) : [],
    );
    for (const field of baseline['required'] as string[]) {
      if (!currentRequired.has(field)) {
        violations.push(`${where}: required field '${field}' is no longer required`);
      }
    }
  }

  if (isRecord(baseline['properties'])) {
    const currentProperties = isRecord(current['properties']) ? current['properties'] : {};
    for (const [name, schema] of Object.entries(baseline['properties'])) {
      if (!(name in currentProperties)) {
        violations.push(`${where}: property '${name}' was removed`);
        continue;
      }
      compareSchemas(schema, currentProperties[name], `${where}.${name}`, violations);
    }
  }

  if (isRecord(baseline['items'])) {
    compareSchemas(baseline['items'], current['items'], `${where}[]`, violations);
  }

  // Response envelopes: content -> media type -> schema.
  for (const nested of ['content', 'application/json', 'schema'] as const) {
    if (isRecord(baseline[nested])) {
      compareSchemas(
        baseline[nested],
        isRecord(current[nested]) ? current[nested] : {},
        where,
        violations,
      );
    }
  }
}

/** Returns every compatibility violation of `current` against `baseline`. */
export function compareOpenApi(baseline: unknown, current: unknown): string[] {
  const violations: string[] = [];
  const basePaths = (baseline as OpenApiLike).paths ?? {};
  const currentPaths = (current as OpenApiLike).paths ?? {};

  for (const [path, baseOperations] of Object.entries(basePaths)) {
    const currentOperations = currentPaths[path];
    if (!currentOperations) {
      violations.push(`endpoint removed: ${path}`);
      continue;
    }
    for (const [method, baseOperation] of Object.entries(baseOperations)) {
      if (!HTTP_METHODS.has(method)) continue;
      const currentOperation = currentOperations[method];
      if (!currentOperation || !isRecord(currentOperation)) {
        violations.push(`endpoint removed: ${method.toUpperCase()} ${path}`);
        continue;
      }
      if (!isRecord(baseOperation)) continue;
      const where = `${method.toUpperCase()} ${path}`;

      if (isRecord(baseOperation['requestBody'])) {
        compareSchemas(
          baseOperation['requestBody'],
          currentOperation['requestBody'],
          `${where} request`,
          violations,
        );
      }
      if (isRecord(baseOperation['responses'])) {
        const currentResponses = isRecord(currentOperation['responses'])
          ? currentOperation['responses']
          : {};
        for (const [status, baseResponse] of Object.entries(baseOperation['responses'])) {
          if (!(status in currentResponses)) {
            violations.push(`${where}: response ${status} was removed`);
            continue;
          }
          compareSchemas(
            baseResponse,
            currentResponses[status],
            `${where} response ${status}`,
            violations,
          );
        }
      }
    }
  }
  return violations;
}
