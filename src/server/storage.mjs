import path from "node:path";

export function resolveDataDirectory({ envDataDir, configuredDataDir, defaultDataDir = path.join(process.cwd(), "data") } = {}) {
  return path.normalize(envDataDir || configuredDataDir || defaultDataDir);
}

export function selectInitialDataDirectory({ pointerDataDir, configuredDataDir, installDataDir } = {}) {
  return path.normalize(pointerDataDir || configuredDataDir || installDataDir);
}
