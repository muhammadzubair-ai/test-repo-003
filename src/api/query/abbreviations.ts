import dictionary from "./abbreviations.json";

/**
 * Abbreviation expander (ARCH-6).
 *
 * The dictionary maps abbreviations to full terms. Entries are the ARCH-6
 * examples. Search_Log uses ac, lh, rh, abs, and a/c; nothing here is taken
 * from Search_Eval. Run this before spelling correction so an abbreviation
 * is expanded rather than "corrected". Each expansion is recorded, and
 * lexical retrieval receives both the expanded terms and the original token.
 */

export type AbbreviationInterpretation = {
  /** Token as it appeared in the query. */
  token: string;
  /** Full term the abbreviation stands for. */
  expansion: string;
};

export type ExpandedQuery = {
  originalTokens: string[];
  /** Full terms added for abbreviations, in query order. */
  added: string[];
  /** Original tokens followed by the words of each expansion. */
  lexicalTokens: string[];
  interpretations: AbbreviationInterpretation[];
};

const EXPANSIONS: Readonly<Record<string, string>> = dictionary;

/** Lookup key: case-insensitive, so "AC" and "a/c" both match "ac". */
function dictionaryKey(token: string): string {
  return token.toLowerCase().replace(/[./]/g, "");
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter((token) => token.length > 0);
}

export function expandAbbreviations(query: string): ExpandedQuery {
  const originalTokens = tokenize(query);
  const added: string[] = [];
  const interpretations: AbbreviationInterpretation[] = [];

  for (const token of originalTokens) {
    const expansion = EXPANSIONS[dictionaryKey(token)];
    if (!expansion) continue;
    added.push(expansion);
    interpretations.push({ token, expansion });
  }

  const lexicalTokens = [...originalTokens];
  for (const expansion of added) {
    for (const word of expansion.split(/\s+/)) {
      if (word.length > 0) lexicalTokens.push(word);
    }
  }

  return { originalTokens, added, lexicalTokens, interpretations };
}
