import { expandAbbreviations } from "./abbreviations";

/**
 * Spelling corrector (ARCH-8).
 *
 * Each token is skipped when it contains a digit, the query is a part-number
 * candidate (ARCH-3), the token was already expanded as an abbreviation, or
 * the token is already in the vocabulary. Otherwise the top pg_trgm
 * candidates are ranked by Damerau-Levenshtein distance. The limit is 1 for
 * tokens of 5 characters or fewer and 2 for longer tokens. Ties go to the
 * more frequent term. Semantic fallback is out of scope.
 */

export type VocabularyTerm = {
  term: string;
  frequency: number;
};

export type SpellingInterpretation = {
  kind: "spelling";
  token: string;
  correction: string;
};

export type SpellingCorrection = {
  text: string;
  interpretations: SpellingInterpretation[];
};

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter((token) => token.length > 0);
}

/** Same lookup key as the abbreviation expander: case-insensitive, dots and slashes removed. */
function abbreviationKey(token: string): string {
  return token.toLowerCase().replace(/[./]/g, "");
}

/** ARCH-3 part-number candidate check. Vocabulary words block a multi-token candidate. */
export function isPartNumberCandidate(query: string, vocabularyWords: ReadonlySet<string> = new Set()): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return true;

  const vocab = new Set([...vocabularyWords].map((word) => word.toUpperCase()));
  for (const token of tokens) {
    if (vocab.has(token.toUpperCase())) return false;
    const shortAlpha = token.length <= 4 && /^[A-Za-z0-9]+$/.test(token);
    if (!/\d/.test(token) && !shortAlpha) return false;
  }
  return true;
}

/** Damerau-Levenshtein distance with adjacent transpositions. */
export function damerauLevenshtein(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i][0] = i;
  for (let j = 0; j < cols; j++) dist[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        dist[i][j] = Math.min(dist[i][j], dist[i - 2][j - 2] + 1);
      }
    }
  }
  return dist[left.length][right.length];
}

function allowedDistance(token: string): number {
  return token.length <= 5 ? 1 : 2;
}

/** Best vocabulary candidate within the distance limit, or null to keep the token. */
export function chooseCorrection(token: string, candidates: readonly VocabularyTerm[]): string | null {
  const limit = allowedDistance(token);
  let best: { term: string; distance: number; frequency: number } | null = null;

  for (const candidate of candidates) {
    const distance = damerauLevenshtein(token, candidate.term);
    if (distance === 0 || distance > limit) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && candidate.frequency > best.frequency)
    ) {
      best = { term: candidate.term, distance, frequency: candidate.frequency };
    }
  }

  return best?.term ?? null;
}

export type CandidateSource = (token: string) => readonly VocabularyTerm[];

/**
 * Correct a query. `candidatesFor` supplies the pg_trgm top 10 for a token.
 * Known words come from `vocabulary`.
 */
export function correctQuery(
  query: string,
  vocabulary: readonly VocabularyTerm[],
  candidatesFor: CandidateSource,
): SpellingCorrection {
  const tokens = tokenize(query);
  const known = new Set(vocabulary.map((term) => term.term.toLowerCase()));
  const abbreviations = new Set(
    expandAbbreviations(query).interpretations.map((item) => abbreviationKey(item.token)),
  );

  if (tokens.length === 0 || isPartNumberCandidate(query, known)) {
    return { text: query.trim(), interpretations: [] };
  }

  const interpretations: SpellingInterpretation[] = [];
  const corrected = tokens.map((token) => {
    const key = abbreviationKey(token);
    if (/\d/.test(token) || abbreviations.has(key) || known.has(token.toLowerCase())) return token;
    const correction = chooseCorrection(token, candidatesFor(token));
    if (!correction || correction.toLowerCase() === token.toLowerCase()) return token;
    interpretations.push({ kind: "spelling", token, correction });
    return correction;
  });

  if (interpretations.length === 0) return { text: query.trim(), interpretations: [] };
  return { text: corrected.join(" "), interpretations };
}

export type SpellingDb = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/** Top 10 VocabularyTerm rows by pg_trgm similarity. */
export async function trigramCandidates(token: string, client: SpellingDb): Promise<VocabularyTerm[]> {
  const key = token.toLowerCase();
  return client.$queryRaw<VocabularyTerm[]>`
    SELECT term, frequency
    FROM "VocabularyTerm"
    WHERE similarity(term, ${key}) >= 0.3
    ORDER BY similarity(term, ${key}) DESC, frequency DESC
    LIMIT 10
  `;
}

/** Load VocabularyTerm and correct the query with pg_trgm candidates. */
export async function correctSpelling(query: string, client: SpellingDb): Promise<SpellingCorrection> {
  const vocabulary = await client.$queryRaw<VocabularyTerm[]>`
    SELECT term, frequency FROM "VocabularyTerm"
  `;
  const known = new Set(vocabulary.map((term) => term.term.toLowerCase()));
  const abbreviations = new Set(
    expandAbbreviations(query).interpretations.map((item) => abbreviationKey(item.token)),
  );
  const cache = new Map<string, VocabularyTerm[]>();

  if (!isPartNumberCandidate(query, known)) {
    for (const token of tokenize(query)) {
      if (/\d/.test(token) || abbreviations.has(abbreviationKey(token)) || known.has(token.toLowerCase())) {
        continue;
      }
      cache.set(token, await trigramCandidates(token, client));
    }
  }

  return correctQuery(query, vocabulary, (token) => cache.get(token) ?? []);
}
