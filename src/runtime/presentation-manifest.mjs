export const LIBREOFFICE_VERSION = "26.2.4";
export const LIBREOFFICE_BUNDLE_NAME = "LibreOfficePortable_26.2.4_MultilingualStandard.paf.exe";
export const DEFAULT_PRESENTATION_DEPENDENCY_MANIFEST = {
  schemaVersion: 1,
  name: "libreoffice",
  version: LIBREOFFICE_VERSION,
  platform: "win32-x64",
  format: "paf-exe",
  sha256: "4bde93374aef4409243505b20d16561a4628ac7591457dd01fc6e1ccf571ba65",
  entrypoint: "App/libreoffice/program/soffice.exe",
  acquisition: ["mybox", "offline-bundle"],
  installMode: "portable-extract-only",
  status: "release-pinned",
  license: "MPL-2.0",
};
