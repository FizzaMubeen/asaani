/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Every signed payload in Asaani is serialized with this and nothing else.
 * If two implementations disagree here, every signature they exchange will fail
 * verification for reasons no user can understand — so this file is small,
 * dependency-free, intentionally strict, and unit-tested.
 *
 * Rules implemented:
 *  - object keys sorted by UTF-16 code unit order
 *  - no insignificant whitespace
 *  - numbers in ECMAScript Number::toString form ("1e+21", "0.1", "-0" -> "0")
 *  - strings escaped exactly as JSON.stringify does (control chars -> \u00XX)
 *  - UTF-8 output
 *
 * Deliberately rejected rather than coerced: undefined, functions, symbols,
 * BigInt, NaN, Infinity, circular references. A signer must never guess what the
 * peer will serialize.
 */

export class CanonicalError extends Error {}

const MAX_DEPTH = 32

export function canonicalize(value: unknown): string {
  return write(value, 0, new Set())
}

function write(value: unknown, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) throw new CanonicalError('payload nested too deeply')

  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'

    case 'string':
      return JSON.stringify(value)

    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalError('non-finite number')
      // JSON.stringify(-0) === "0", which is what JCS requires.
      return JSON.stringify(value)

    case 'object':
      break

    default:
      throw new CanonicalError(`unsupported type: ${typeof value}`)
  }

  const obj = value as object
  if (seen.has(obj)) throw new CanonicalError('circular reference')
  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = []
      for (const item of obj) {
        if (item === undefined) throw new CanonicalError('undefined array element')
        parts.push(write(item, depth + 1, seen))
      }
      return `[${parts.join(',')}]`
    }

    if (obj instanceof Uint8Array) throw new CanonicalError('bytes must be encoded as base64url first')

    const record = obj as Record<string, unknown>
    const keys = Object.keys(record).sort(compareCodeUnits)
    const parts: string[] = []
    for (const key of keys) {
      const v = record[key]
      if (v === undefined) throw new CanonicalError(`undefined property: ${key}`)
      parts.push(`${JSON.stringify(key)}:${write(v, depth + 1, seen)}`)
    }
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(obj)
  }
}

/** UTF-16 code unit order, which is what RFC 8785 mandates (not localeCompare). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export const utf8 = new TextEncoder()
