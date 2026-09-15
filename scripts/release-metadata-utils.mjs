export function metadataTextMatches(actual, expected) {
  const normalizeLineEndings = (value) => String(value ?? "").replace(/\r\n?/gu, "\n");
  return normalizeLineEndings(actual) === normalizeLineEndings(expected);
}
