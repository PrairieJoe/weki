import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const onboarding = await readFile(new URL("../src/onboarding.js", import.meta.url), "utf8").catch(() => "");
const searchService = await readFile(new URL("../src/search/service.mjs", import.meta.url), "utf8");
const runtimePresentation = await readFile(new URL("../src/runtime/presentation.mjs", import.meta.url), "utf8");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const electronMain = await readFile(new URL("../electron-main.cjs", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const myboxSync = await readFile(new URL("../src/server/mybox-sync.mjs", import.meta.url), "utf8");
const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
const statusApiTest = await readFile(new URL("../test/status-api.test.mjs", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const runScript = await readFile(new URL("../run-weki.bat", import.meta.url), "utf8");
const buildInfo = await readFile(new URL("../release/BUILD_INFO.txt", import.meta.url), "utf8");
const latestYml = await readFile(new URL("../release/latest.yml", import.meta.url), "utf8");
const sha256 = await readFile(new URL("../release/SHA256.txt", import.meta.url), "utf8");
const releaseNotesV121 = await readFile(new URL("../docs/RELEASE_NOTES_V1.2.1.md", import.meta.url), "utf8").catch(() => "");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
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

test("Weki search presents bounded highlighted evidence and integer relevance", () => {
  assert.match(main, /data-evidence-expand/);
  assert.match(main, /highlightEvidence/);
  assert.match(main, /formatDisplayScore/);
  assert.match(main, /aria-label=.*연관성/);
  assert.match(styles, /\.evidence-text mark/);
});

test("Weki exposes managed and suggested synonym states", () => {
  assert.match(server, /status: "approved"/);
  assert.match(server, /source: "manual"/);
  assert.match(main, /승인 대기/);
  assert.match(main, /data-approve-synonym/);
  assert.match(main, /data-reject-synonym/);
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

test("Weki keeps the document renderer out of the production package", () => {
  assert.equal(packageJson.dependencies?.["@rhwp/core"], undefined);
  assert.equal(packageJson.devDependencies?.["@rhwp/core"], "0.8.4");
  assert.doesNotMatch(server, /bundledRendererPath/);
  assert.ok(packageJson.build?.files?.includes("!node_modules/@rhwp/**"));
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

test("Weki uninstaller stops running app processes before removing files", () => {
  const uninstallStart = installer.indexOf("!macro customUnInstall");
  const uninstall = installer.slice(uninstallStart);
  const stopProcesses = uninstall.indexOf("taskkill.exe");
  const cleanup = uninstall.indexOf("ReadRegStr $WekiRootCount");
  assert.ok(uninstallStart >= 0);
  assert.ok(stopProcesses >= 0);
  assert.ok(stopProcesses < cleanup);
  assert.match(uninstall, /taskkill\.exe.*\/F \/T \/IM "\$\{APP_EXECUTABLE_FILENAME\}"/);
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

test("Weki development files remain portable across checkout paths", () => {
  assert.doesNotMatch(statusApiTest, /cwd:\s*["'][A-Za-z]:[\\/]/);
  assert.match(statusApiTest, /fileURLToPath/);
  assert.match(statusApiTest, /projectRoot/);
  assert.match(runScript, /call npm ci/);
  assert.doesNotMatch(runScript, /call npm install/);
  assert.match(readme, /Node\.js 22\.12\.0/);
  assert.match(readme, /npm ci/);
  assert.doesNotMatch(buildInfo, /Installer path: [A-Za-z]:[\\/]/);
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

test("Weki keeps semantic runtime installation visible and updates MYBOX credentials without a full render", () => {
  assert.match(main, /const installControls=installButtons/);
  assert.match(main, /\$\{installControls\}/);
  assert.match(main, /applyMyboxCredentialResult/);
  assert.match(main, /서버를 재연결하는 중/);
  assert.doesNotMatch(main, /const result=await bridge\.saveToken\(input\.value\); input\.value=""; state\.toast=.*await refresh\(\); render\(\);/);
  assert.doesNotMatch(main, /const result=await bridge\.clearToken\(\); state\.toast=.*await refresh\(\); render\(\);/);
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

test("Weki release metadata is promoted to v1.2.1", () => {
  assert.equal(packageJson.version, "1.2.1");
  assert.equal(packageLock.version, "1.2.1");
  assert.equal(packageLock.packages?.[""].version, "1.2.1");
  assert.equal(packageJson.build?.artifactName, "Weki-${version}-Setup.exe");
  assert.match(releaseNotesV121, /1\.2\.1/);
  assert.match(buildInfo, /Application version:\s*1\.2\.1/);
  assert.match(buildInfo, /Weki-1\.2\.1-Setup\.exe/);
  assert.match(latestYml, /version:\s*1\.2\.1/);
  assert.match(latestYml, /Weki-1\.2\.1-Setup\.exe/);
  assert.match(sha256, /Weki-1\.2\.1-Setup\.exe\s+[A-Fa-f0-9]{64}/);
  assert.match(readme, /v1\.2\.0 개선사항/);
  assert.match(readme, /release\/Weki-1\.2\.0-Setup\.exe/);
});

test("Weki exposes a replayable five-step onboarding tour", () => {
  assert.match(main, /사용 가이드/);
  assert.match(main, /data-onboarding-replay/);
  for (const target of ["search-composer", "registration-dropzone", "evidence-fallback", "processing-mode", "mybox"]) {
    assert.match(main, new RegExp(`data-onboarding-target=["']${target}["']`));
  }
  assert.match(onboarding, /role=["']dialog["']/);
  assert.match(onboarding, /aria-modal=["']true["']/);
  assert.match(onboarding, /data-onboarding-progress/);
  assert.match(onboarding, /건너뛰기/);
  assert.match(onboarding, /다음/);
  assert.match(main, /사용 가이드/);
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
  assert.match(main, /semanticReady/);
  assert.match(main, /semanticHealth/);
  assert.match(main, /local-ai/);
  assert.match(main, /모델 설치 후/);
  assert.match(main, /aria-disabled/);
  assert.match(styles, /\.disabled/);
});

test("Weki explains all runtime component states and supports a single install flow", () => {
  assert.match(main, /semantic-model/);
  assert.match(main, /semantic-reranker/);
  assert.match(main, /document-renderer/);
  assert.match(main, /전체 설치/);
  assert.match(main, /배포 준비 중/);
  assert.match(main, /업데이트/);
  assert.match(main, /정상 작동/);
  assert.doesNotMatch(main, /고급 관리/);
  assert.doesNotMatch(main, /다른 PC에서 검색 데이터/);
  assert.match(server, /install-all/);
  assert.match(server, /availableVersion/);
  assert.match(server, /updateAvailable/);
});

test("Weki keeps the full-install action separate from the runtime description", () => {
  assert.match(main, /classList\.add\("runtime-description"\)/);
  assert.match(main, /card\.querySelector\("\.runtime-description"\)/);
  assert.match(main, /button\.textContent=.*전체 설치/);
  assert.doesNotMatch(main, /const description=heading\?\.nextElementSibling/);
});

test("Weki wires source-aware runtime outcomes into stable component rows", () => {
  assert.match(main, /MYBOX 배포본 없음/);
  assert.match(main, /재시도/);
  assert.match(main, /설치 가능한 구성요소 설치가 완료되었습니다/);
  assert.match(main, /runtimeBatchMessage/);
  assert.match(main, /sourceType/);
  assert.match(main, /data-runtime-component/);
  assert.match(main, /dataset\.runtimeComponent===entry\.id/);
  assert.match(main, /source:metadata\.sourceType==="mybox"\?"mybox":null/);
  assert.match(main, /runtime-batch-message/);
  assert.match(main, /function runtimeInstallMetadata\(id,entry=state\.runtime\?\.components\?\.\[id\]\)/);
  assert.match(main, /entry\?\.sourceType/);
  assert.match(main, /entry\?\.requiresMybox/);
  assert.match(main, /entry\?\.version/);
  assert.match(runtimePresentation, /entry\?\.id==="document-renderer"&&metadata\?\.sourceType!=="mybox"/);
  assert.match(main, /document-renderer.*sourceType.*mybox/);
  assert.match(main, /note\.textContent=batchNote/);
  assert.match(main, /entry\.status==="failed"&&entry\.error/);
  assert.match(main, /entry\.requiresMybox&&entry\.installable===false/);
  assert.ok(main.indexOf('entry.requiresMybox&&entry.installable===false') < main.indexOf('entry.status==="failed"&&entry.error'));
});

test("Weki persists the processing default and derives Local AI readiness", () => {
  assert.match(main, /defaultProcessingMode/);
  assert.match(main, /\/api\/settings/);
  assert.match(main, /설치 상태에 따라 자동/);
  assert.match(main, /Local AI 사용/);
  assert.match(server, /defaultProcessingMode/);
  assert.match(server, /effectiveDefaultMode/);
  assert.match(server, /localAiEligible/);
});

test("Weki exposes runtime status, install progress and a restart action", () => {
  assert.match(server, /document-renderer/);
  assert.match(server, /completedFiles/);
  assert.match(main, /runtime-components-card/);
  assert.match(main, /다운로드 중/);
  assert.match(main, /id="restart-app"/);
  assert.doesNotMatch(main, /id="restart-app-runtime"/);
  assert.match(main, /우측 상단.*앱 다시 시작/);
  assert.match(preload, /weki:restart/);
  assert.match(electronMain, /weki:restart/);
  assert.doesNotMatch(server, /\/api\/mybox\/runtime\/prepare/);
  assert.doesNotMatch(main, /prepare-mybox-runtime/);
  assert.match(server, /source === "mybox"/);
  assert.match(server, /baseUrl = `mybox:\/\/runtime/);
  assert.doesNotMatch(server, /for \(const file of component\.files\) file\.url/);
  assert.match(server, /restartRequired: \["semantic-model", "semantic-reranker", "document-renderer"\]\.includes\(component\.id\)/);
  assert.match(main, /document-renderer-install-slot/);
  assert.doesNotMatch(main, /id="install-mybox-renderer"/);
  assert.match(server, /runtimeComponents/);
  assert.match(main, /runtime\.runtimeComponents/);
  assert.match(main, /myboxRuntimePromise/);
  assert.match(main, /myboxRuntimeFetchedAt/);
  assert.match(main, /myboxRendererInstalling/);
  assert.match(main, /MYBOX_RUNTIME_CACHE_TTL/);
  assert.match(main, /manifest가 아직 게시되지 않았습니다/);
});

test("Weki refreshes active jobs before deciding whether runtime install may restart", () => {
  const polling = main.match(/function startRuntimePolling\(\).*?function resetMyboxRuntimeCache/s)?.[0] || "";
  assert.match(polling, /fetch\("\/api\/jobs"\)/);
  assert.ok(polling.indexOf('fetch("/api/jobs")') < polling.indexOf("scheduleRuntimeRestart"));
});

test("Weki keeps search-index recovery out of the renderer settings UI", () => {
  assert.doesNotMatch(main, /암호화 백업 및 복원/);
  assert.doesNotMatch(main, /검색 색인 다시 만들기/);
  assert.doesNotMatch(main, /검색 색인 관리/);
  assert.doesNotMatch(main, /id="reindex-search"/);
  assert.doesNotMatch(main, /searchV2/);
  assert.doesNotMatch(main, /searchReindexPollTimer/);
  assert.doesNotMatch(main, /syncSearchReindexControls/);
  assert.doesNotMatch(main, /startSearchReindexPolling/);
  const refresh = main.match(/async function refresh\(\).*?async function runSearch/s)?.[0] || "";
  assert.match(refresh, /fetch\("\/api\/status"\)/);
  assert.doesNotMatch(refresh, /fetch\("\/api\/v2\/status"\)/);
});

test("Weki exposes only the app release version while retaining internal compatibility versions", () => {
  assert.doesNotMatch(main, /암호화 백업 및 복원/);
  assert.doesNotMatch(main, /data-backup/);
  assert.match(main, /import packageJson from "\.\.\/package\.json"/);
  assert.match(main, /const APP_VERSION = packageJson\.version/);
  assert.match(main, /앱 버전 \$\{APP_VERSION\}/);
  assert.match(main, /data-runtime-version="\$\{escape\(installable\[entry\.id\]\.version\)\}"/);
  assert.doesNotMatch(main, /status\.textContent=`\$\{statusText\}\$\{entry\.version/);
  assert.doesNotMatch(main, /\$\{escape\(statusLabel\[entry\.status\]\|\|entry\.status\)\}\$\{entry\.version/);
  assert.doesNotMatch(main, /문서 화면 처리기 \$\{renderer\.version\} 배포본/);
  assert.match(main, /문서 화면 처리기 배포본을 확인했습니다\./);
  assert.match(searchService, /export const RANKING_VERSION/);
});

test("Weki records the effective analysis mode and semantic indexing stage", () => {
  assert.match(server, /effectiveProcessingMode/);
  assert.match(server, /processingModeResolution/);
  assert.match(server, /semantic_model_unavailable/);
  assert.match(server, /processingModeFallback/);
  assert.match(server, /advancedAnalysis/);
  assert.match(server, /semanticAnalysisStatus/);
  assert.match(server, /Local AI.*의미 색인 완료/);
  assert.match(main, /Local AI 모델이 준비되지 않아 경량 처리로 전환했습니다/);
});
