# Weki third-party notices

| Component | Version | License | Distribution |
| --- | --- | --- | --- |
| LibreOffice Portable Windows x86-64 | 26.2.4 | MPL 2.0 and bundled component licenses | Managed dependency; optional Full Offline bundle under `resources/dependency-bundles/` |
| 7-Zip extractor | build-toolchain runtime | LGPL-2.1-or-later | `resources/tools/7zip/7z.exe` and `7z.dll` |
| rhwp | 0.8.4 | MIT | `@rhwp/core` HWP/HWPX renderer |

Online and Full Offline profiles use the same pinned LibreOffice Portable bundle. Online downloads it on demand; Full Offline carries the verified bundle when the release pipeline populates `resources/dependency-bundles/`. Weki extracts it into the versioned managed dependency path and never performs LibreOffice MSI registration or system-wide installation.

LibreOffice is pinned in `resources/dependency-manifests/libreoffice-windows-x64.json`:

- Source: `https://download.documentfoundation.org/libreoffice/portable/26.2.4/LibreOfficePortable_26.2.4_MultilingualStandard.paf.exe`
- SHA-256: `4BDE93374AEF4409243505B20D16561A4628AC7591457DD01FC6E1CCF571BA65`
- Entrypoint after extraction: `App/libreoffice/program/soffice.exe`
- Source and license information: [LibreOffice downloads](https://www.libreoffice.org/download/)

The 7-Zip helper is copied from the official-compatible runtime distributed by the build toolchain. The corresponding source and license information must be retained with each release artifact: [7-Zip downloads](https://www.7-zip.org/download.html), [7-Zip FAQ](https://www.7-zip.org/faq.html).
