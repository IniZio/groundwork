/** Jaccard similarity threshold. Sentences below this score are treated as deletions. */
export declare const MATCH_THRESHOLD: number

/** Returns true if this file path is a prose surface that the guard should protect. */
export declare function isProse(filePath: unknown): boolean

/** Split text into sentences (boundaries: .!? followed by whitespace, or newlines). */
export declare function splitSentences(text: string): string[]

/** Jaccard similarity of word sets (case-insensitive). */
export declare function jaccard(a: string, b: string): number

/** Find best-matching sentence in newSents for oldSent. Returns null if below threshold. */
export declare function matchSentence(
  oldSent: string,
  newSents: string[],
  threshold?: number,
): string | null
