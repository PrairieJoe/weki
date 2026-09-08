const normalize = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();

export function buildVisualContext({ nativeText = "", caption = "" } = {}) {
  return [nativeText, caption].map(normalize).filter(Boolean).join(" ");
}
