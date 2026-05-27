const CONTEXT_WINDOW_OPTION_ID = "contextWindow";
const DEFAULT_CHARS_PER_TOKEN = 4;

/**
 * Parses a context-window token value string into a number.
 *
 * Recognises compact forms ("200k", "1m", "1.5m") and plain integer strings.
 * Returns `null` for unrecognised or empty input.
 */
export function parseContextWindowTokenValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const compactMatch = trimmed.match(/^(\d+\.?\d*)\s*(k|m)$/i);
  if (compactMatch) {
    const [, numStr, unit] = compactMatch;
    const num = Number.parseFloat(numStr!);
    if (!Number.isFinite(num) || num <= 0) {
      return null;
    }
    const multiplier = unit!.toLowerCase() === "m" ? 1_000_000 : 1_000;
    return Math.round(num * multiplier);
  }

  const intMatch = trimmed.match(/^\d+$/);
  if (intMatch) {
    const num = Number.parseInt(trimmed, 10);
    return num > 0 ? num : null;
  }

  return null;
}

/**
 * Extracts the context-window token limit from an options array.
 *
 * Looks for an entry with id `"contextWindow"` and a string value,
 * then parses the value with {@link parseContextWindowTokenValue}.
 * Returns `null` when no context-window option is present or the
 * value cannot be parsed.
 */
export function resolveContextWindowLimit(
  options:
    | ReadonlyArray<{ readonly id: string; readonly value: string | boolean }>
    | null
    | undefined,
): number | null {
  if (!options || options.length === 0) {
    return null;
  }

  for (const option of options) {
    if (option.id === CONTEXT_WINDOW_OPTION_ID && typeof option.value === "string") {
      return parseContextWindowTokenValue(option.value);
    }
  }

  return null;
}

/**
 * Estimates a token count from text segments using a character heuristic.
 *
 * Sums character counts across all segments and divides by `charsPerToken`
 * (default 4). Returns a non-negative integer. Returns 0 for empty input.
 */
export function estimateContentTokens(
  segments: ReadonlyArray<{ readonly text: string }>,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (segments.length === 0) {
    return 0;
  }

  const ratio = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  let totalChars = 0;

  for (const segment of segments) {
    totalChars += typeof segment.text === "string" ? segment.text.length : 0;
  }

  return Math.max(0, Math.ceil(totalChars / ratio));
}
