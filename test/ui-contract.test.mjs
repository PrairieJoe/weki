import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const electronMain = await readFile(new URL("../electron-main.cjs", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const myboxSync = await readFile(new URL("../src/server/mybox-sync.mjs", import.meta.url), "utf8");
const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const preloadUrl = new URL("../src/preload.cjs", import.meta.url);
const preload = await readFile(preloadUrl, "utf8").catch(() => "");

test("Weki uses the documented indigo design tokens", () => {
  assert.match(styles, /--primary:\s*#000666/i);
  assert.match(styles, /IBM Plex Sans/);
  assert.match(styles, /JetBrains Mono/);
});

test("Weki search has a persistent composer and accessible navigation", () => {
  assert.match(styles, /\.search-composer/);
  assert.match(main, /aria-current=/);
  assert.match(main, /role="search"/);
});

test("Weki exposes a managed destructive-operation dialog", () => {
  assert.match(main, /role="dialog"/);
  assert.match(main, /aria-modal="true"/);
});

test("Weki refreshes active processing jobs without user interaction", () => {
  assert.match(main, /setInterval\(async \(\) => \{[\s\S]*?activeJobs\(\)\.length[\s\S]*?refresh\(\)[\s\S]*?render\(\)/);
});

test("Weki keeps completed jobs out while retaining failed jobs in the processing view", () => {
  assert.match(server, /visibleJobs\(db\.jobs\)/);
  assert.match(main, /state\.jobs=jobData\.jobs\.slice\(0,20\)/);
});

test("Weki starts without requiring a working GPU process", () => {
  assert.match(electronMain, /disableHardwareAcceleration\(\)/);
  assert.match(electronMain, /appendSwitch\(['"]in-process-gpu['"]\)/);
});

test("Weki keeps the Vite server runtime dependency in production dependencies", () => {
  assert.equal(typeof packageJson.dependencies?.vite, "string");
});

test("Weki uses a writable user-data directory when packaged", () => {
  assert.match(server, /process\.env\.WEKI_DATA_DIR/);
  assert.match(electronMain, /WEKI_DATA_DIR/);
});

test("Weki stores the selected data path outside AppData and does not silently fall back", () => {
  assert.match(electronMain, /reg\.exe/);
  assert.match(electronMain, /DataDir/);
  assert.match(electronMain, /storage-location\.json/);
  assert.doesNotMatch(electronMain, /configPath = path\.join\(localAppData/);
  assert.match(electronMain, /const initialPointerDataDir = app\.isPackaged \? readStoragePointer\(\) : null/);
  assert.match(electronMain, /configureRuntimeStorage/);
  assert.match(electronMain, /path\.join\(dataDir, '\.runtime'\)/);
  assert.doesNotMatch(electronMain, /Weki-runtime-cache/);
});

test("Weki asks before granting install-folder storage access and does not silently fall back", () => {
  assert.match(electronMain, /관리자 권한/);
  assert.match(electronMain, /process\.execPath/);
  assert.match(electronMain, /showOpenDialog/);
});

test("Weki exposes original-inclusive MYBOX merge operations", () => {
  assert.match(main, /원본 포함 MYBOX 백업/);
  assert.match(main, /id="mybox-upload"/);
  assert.match(main, /id="mybox-download"/);
  assert.match(main, /원본 포함 평문 백업/);
  assert.match(server, /app\.post\("\/api\/mybox\/upload"/);
  assert.match(server, /app\.post\("\/api\/mybox\/download"/);
});

test("Weki explains the separated MYBOX original layout", () => {
  assert.match(main, /knowledge-base\.json/);
  assert.match(main, /weki\/data/);
  assert.match(main, /실제 원본 파일/);
  assert.doesNotMatch(server, /legacyData|repairLegacyFolderOriginals/);
  assert.match(myboxSync, /entry\.storagePath|storagePath/);
});

test("Weki separates MYBOX catalog synchronization from lazy original restore", () => {
  assert.match(main, /MYBOX 검색 DB 동기화/);
  assert.match(main, /MYBOX에 원본\+검색 DB 백업 업로드/);
  assert.match(main, /MYBOX에서 검색 DB만 동기화/);
  assert.match(main, /MYBOX에서 원본 가져와 열기/);
  assert.match(main, /data-open-original/);
  assert.match(server, /app\.post\("\/api\/mybox\/sync"/);
  assert.match(server, /cloudOriginalFile/);
  assert.match(server, /knowledge-base\.json/);
});

test("Weki makes MYBOX audit scope explicit", () => {
  assert.match(server, /MYBOX 백업 업로드 · 원본 파일 포함 · knowledge-base\.json 갱신/);
  assert.match(server, /MYBOX 검색 DB 동기화 · knowledge-base\.json만 다운로드/);
});

test("Weki exposes physical page count separately from searchable coverage", () => {
  assert.match(main, /페이지/);
  assert.match(server, /searchablePageCount/);
  assert.match(server, /pages: metrics\.pageCount/);
});

test("Weki moves a user-selected storage location and cleans the managed source", () => {
  assert.match(main, /id="storage-target"/);
  assert.match(main, /id="migrate-storage"/);
  assert.match(server, /restartRequired: true/);
  assert.match(server, /copyStoreContents\(staging\)/);
  assert.match(server, /sourceRemoved/);
  assert.match(server, /updateWindowsStoragePointer/);
});

test("Weki keeps failed registration jobs visible and exposes retry and dismiss actions", () => {
  assert.match(server, /failed/);
  assert.match(main, /data-job="retry"/);
  assert.match(main, /data-job="dismiss"/);
});

test("Weki records a deterministic storage pointer for silent installs", () => {
  assert.match(installer, /!macro customInstall/);
  assert.match(installer, /WriteRegStr HKCU "Software\\Weki" "DataDir"/);
  assert.match(installer, /WekiDataDir\\\.runtime/);
  assert.match(installer, /\$TEMP\\Weki-runtime-cache/);
  assert.match(installer, /\$APPDATA\\Weki/);
});

test("Weki accepts a MYBOX token in the installer and stores it outside the package", () => {
  const resources = packageJson.build?.extraResources || [];
  assert.equal(resources.some((item) => typeof item === "object" && item.from === ".env"), false);
  assert.match(installer, /WekiMyboxToken/);
  assert.match(installer, /mybox-token\.bootstrap/);
  assert.match(electronMain, /safeStorage/);
  assert.match(electronMain, /mybox-credentials\.mjs/);
  assert.match(electronMain, /WEKI_MYBOX_CREDENTIAL_STATE/);
  assert.match(electronMain, /WEKI_DISABLE_ENV_FILE: app\.isPackaged \? '1' : '0'/);
  assert.match(electronMain, /if \(!app\.isPackaged\) activeServerEnv\.WEKI_ENV_FILE/);
  assert.match(server, /credentialState/);
  assert.match(server, /WEKI_DISABLE_ENV_FILE/);
  assert.match(server, /MYBOX 토큰이 설정되지 않았습니다\. 관리자에게 문의하세요\./);
  assert.match(main, /MYBOX 토큰이 설정되지 않았습니다\. 관리자에게 문의하세요\./);
});

test("Weki exposes local MYBOX credential actions without returning the token to the renderer", async () => {
  await assert.doesNotReject(access(preloadUrl));
  assert.match(preload, /contextBridge\.exposeInMainWorld\(['"]wekiCredentials['"]/);
  assert.match(preload, /saveToken/);
  assert.match(preload, /clearToken/);
  assert.match(preload, /getStatus/);
  assert.doesNotMatch(preload, /return.*token/);
  assert.match(main, /id="mybox-token"/);
  assert.match(main, /id="save-mybox-token"/);
  assert.match(main, /id="clear-mybox-token"/);
  assert.match(main, /wekiCredentials/);
});

test("Weki applies the supplied icon across the packaged app and UI", async () => {
  const appIcon = await readFile(new URL("../public/app-icon.png", import.meta.url));
  const ico = await readFile(new URL("../build/icon.ico", import.meta.url));
  assert.ok(appIcon.length > 1000);
  const pngWidth = appIcon.readUInt32BE(16); const pngHeight = appIcon.readUInt32BE(20);
  assert.ok(pngWidth >= 1024 && pngHeight >= 1024);
  assert.equal(appIcon[25], 6);
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.ok(ico.readUInt16LE(4) >= 7);
  const icoSizes = [...Array(ico.readUInt16LE(4))].map((_, index) => { const offset = 6 + index * 16; return ico[offset] || 256; });
  assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256]);
  assert.equal(packageJson.build?.icon, "build/icon.ico");
  assert.ok(packageJson.build?.files?.includes("public/**/*"));
  assert.equal(packageJson.build?.artifactName, "Weki-${version}-Setup.exe");
  assert.match(index, /rel="icon"[^>]*app-icon\.png/);
  assert.match(main, /app-icon\.png/);
  assert.match(electronMain, /dist.*app-icon\.png/);
  assert.match(electronMain, /icon:/);
  assert.match(styles, /\.brand-mark img\{[^}]*object-fit:contain/);
});

test("Weki installer pages share one custom value-entry layout", () => {
  assert.equal(packageJson.build?.nsis?.allowToChangeInstallationDirectory, false);
  assert.match(installer, /Page custom WekiInstallDirPageCreate WekiInstallDirPageLeave/);
  assert.match(installer, /Page custom WekiDataPageCreate WekiDataPageLeave/);
  assert.match(installer, /Page custom WekiMyboxTokenPageCreate WekiMyboxTokenPageLeave/);
  assert.match(installer, /!define WEKI_FORM_GROUP_Y 70u/);
  assert.match(installer, /!define WEKI_FORM_INPUT_Y 82u/);
  assert.equal((installer.match(/NSD_CreateGroupBox\} \$\{WEKI_FORM_GROUP_X\} \$\{WEKI_FORM_GROUP_Y\}/g) || []).length, 3);
  assert.doesNotMatch(installer, /NSD_CreateVLine/);
  assert.doesNotMatch(installer, /nsDialogs::CreateControl STATIC/);
  assert.equal((installer.match(/NSD_CreateDirRequest\} \$\{WEKI_FORM_INPUT_X\} \$\{WEKI_FORM_INPUT_Y\}/g) || []).length, 2);
  assert.equal((installer.match(/NSD_CreateBrowseButton\} \$\{WEKI_FORM_BROWSE_X\} \$\{WEKI_FORM_INPUT_Y\}/g) || []).length, 2);
  assert.doesNotMatch(installer, /NSD_CreateText\} \$\{WEKI_FORM_INPUT_X\} \$\{WEKI_FORM_INPUT_Y\}/);
  assert.doesNotMatch(installer, /NSD_CreateButton\} \$\{WEKI_FORM_BROWSE_X\} \$\{WEKI_FORM_INPUT_Y\}/);
  assert.match(installer, /NSD_CreatePassword\} \$\{WEKI_FORM_INPUT_X\} \$\{WEKI_FORM_INPUT_Y\} 272u \$\{WEKI_FORM_INPUT_H\}/);
  assert.match(installer, /WekiInstallDirPageCreate/);
  assert.match(installer, /WekiInstallDirPageLeave/);
  assert.match(installer, /WekiUpdateInstallSpace/);
  assert.match(installer, /WekiFormatMegabytes/);
  assert.match(installer, /\$0 < 1024/);
  assert.match(installer, /\$0 < 1048576/);
  assert.match(installer, /StrCpy \$1 "\$0 MB"/);
  assert.match(installer, /StrCpy \$1 "\$0 GB"/);
  assert.match(installer, /StrCpy \$1 "\$0 TB"/);
  assert.match(installer, /\$\(\^SpaceRequired\)/);
  assert.match(installer, /\$\(\^SpaceAvailable\)/);
  assert.match(installer, /DriveSpace/);
  assert.match(installer, /NSD_CreateLabel\} \$\{WEKI_FORM_INPUT_X\} 109u 280u 12u/);
  assert.match(installer, /NSD_CreateLabel\} \$\{WEKI_FORM_INPUT_X\} 123u 280u 12u/);
  assert.match(installer, /설치 폴더/);
  assert.match(installer, /설치 PC의 선택된 Weki 데이터 저장소/);
  assert.match(installer, /StrCpy \$WekiDataDir "\$INSTDIR\\data"[\s\S]*?ReadRegStr \$0 HKCU "Software\\Weki" "DataDir"/);
  assert.match(installer, /IfFileExists "\$INSTDIR\\Weki\.exe"/);
});

test("Weki keeps a removable current registration file selection", () => {
  assert.match(main, /selectedFiles/);
  assert.match(main, /selectedFileKey/);
  assert.match(main, /appendSelectedFiles/);
  assert.match(main, /removeSelectedFile/);
  assert.match(main, /data-remove-selected-file/);
  assert.match(main, /state\.selectedFiles/);
  assert.match(main, /selectedFiles\s*=\s*\[\]/);
  assert.match(styles, /selected-files/);
});

test("Weki disables unfinished AI controls while keeping lightweight processing available", () => {
  assert.match(main, /input\.disabled\s*=\s*true/);
  assert.match(main, /value\s*!==\s*["']lightweight["']/);
  assert.match(main, /aria-disabled/);
  assert.match(main, /준비 중/);
  assert.match(styles, /\.disabled/);
});
