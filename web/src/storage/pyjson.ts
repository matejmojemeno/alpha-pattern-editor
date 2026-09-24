/**
 * `json.dumps(obj)` with Python's defaults, so the JSON entries in an `.alpha` archive
 * written here are byte-identical to the desktop's:
 *   - separators ', ' and ': '
 *   - ensure_ascii: everything outside printable ASCII becomes \uXXXX (lowercase hex)
 *   - floats keep a fractional part: Python writes time.time() stamps as 1700000000.0.
 *
 * JavaScript has one number type, so which keys hold Python floats is passed in. Those
 * keys are written with a '.0' when integral, so Python reads them back as float, not
 * int, exactly as if the desktop had written the file.
 */

export type PyJson = null | boolean | number | string | PyJson[] | { [key: string]: PyJson }

const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

function pyString(s: string): string {
  // Python's ESCAPE_ASCII is /([\\"]|[^\ -~])/; iterating UTF-16 units gives the same
  // surrogate-pair escapes Python emits for astral characters.
  return (
    '"' +
    s.replace(/[\\"]|[^ -~]/g, (ch) => ESCAPES[ch] ?? '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')) +
    '"'
  )
}

function pyNumber(n: number, isFloat: boolean): string {
  if (!Number.isFinite(n)) throw new Error(`cannot serialise ${n} to JSON`)
  // Python's float repr and JS's number-to-string agree (shortest round-trip form) for
  // everything below 1e16, which covers timestamps and counts.
  const s = String(n)
  return isFloat && Number.isInteger(n) ? `${s}.0` : s
}

export function pyJsonDumps(value: PyJson, floatKeys: ReadonlySet<string> = new Set()): string {
  const enc = (v: PyJson, isFloat: boolean): string => {
    if (v === null) return 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return pyNumber(v, isFloat)
    if (typeof v === 'string') return pyString(v)
    if (Array.isArray(v)) return '[' + v.map((x) => enc(x, false)).join(', ') + ']'
    return (
      '{' +
      Object.entries(v)
        .map(([k, x]) => `${pyString(k)}: ${enc(x, floatKeys.has(k))}`)
        .join(', ') +
      '}'
    )
  }
  return enc(value, false)
}
