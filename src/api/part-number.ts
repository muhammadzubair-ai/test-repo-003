/**
 * Part-number normalisation and candidate detection (ARCH-3).
 * Vocabulary words are supplied by the caller — no DB lookup here.
 */

const STRIP_RE = /[\s\-./]+/g;

/** Upper-case and strip whitespace, hyphens, dots and slashes. */
export function normalisePartNumber(s: string): string {
  return s.toUpperCase().replace(STRIP_RE, "");
}

function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function tokenContainsDigit(token: string): boolean {
  return /\d/.test(token);
}

/** Short alphanumeric fragment of 4 characters or fewer (ARCH-3). */
function isShortAlphanumericFragment(token: string): boolean {
  return token.length <= 4 && /^[A-Za-z0-9]+$/.test(token);
}

/**
 * Whether the query may be joined/normalised as a part-number candidate.
 * - single token; or
 * - every token contains a digit or is a short alphanumeric fragment (≤4),
 *   and no token is a vocabulary word.
 */
export function isPartNumberCandidate(
  query: string,
  vocabularyWords: ReadonlySet<string> = new Set(),
): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return true;

  const vocab = new Set([...vocabularyWords].map((w) => w.toUpperCase()));
  for (const token of tokens) {
    if (vocab.has(token.toUpperCase())) return false;
    if (!tokenContainsDigit(token) && !isShortAlphanumericFragment(token)) {
      return false;
    }
  }
  return true;
}

/** Normalised form when the query is a part-number candidate; otherwise null. */
export function partNumberCandidate(
  query: string,
  vocabularyWords: ReadonlySet<string> = new Set(),
): string | null {
  if (!isPartNumberCandidate(query, vocabularyWords)) return null;
  return normalisePartNumber(query);
}
