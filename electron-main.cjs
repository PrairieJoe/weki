const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { requestWithTimeout } = require('./src/runtime/http-readiness.cjs');

const registryKey = 'HKCU\\Software\\Weki';
const installDataDir = app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : path.join(__dirname, '.weki-data');
const grantStorageTarget = process.argv.includes('--weki-grant-storage') ? process.argv[process.argv.indexOf('--weki-grant-storage') + 1] : null;
const registryValue = (name) => {
  if (process.platform !== 'win32') return null;
  try {
    const result = spawnSync('reg.exe', ['query', registryKey, '/v', name], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) return null;
    const match = result.stdout.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'mi'));
    return match?.[1]?.trim() || null;
  } catch { return null; }
};
const writeRegistryValue = (name, type, value) => {
  if (process.platform !== 'win32') return false;
  try { return spawnSync('reg.exe', ['add', registryKey, '/v', name, '/t', type, '/d', value, '/f'], { windowsHide: true, encoding: 'utf8' }).status === 0; } catch { return false; }
};
const readStoragePointer = () => registryValue('DataDir');
const pendingCleanupRoot = app.isPackaged ? registryValue('PendingCleanupRoot') : null;
const runtimeAutoRelaunchArgument = '--weki-runtime-auto-relaunch';
const isRuntimeAutoRelaunch = process.argv.includes(runtimeAutoRelaunchArgument);
const deleteRegistryValue = (name) => {
  if (process.platform !== 'win32') return false;
  try { return spawnSync('reg.exe', ['delete', registryKey, '/v', name, '/f'], { windowsHide: true, encoding: 'utf8' }).status === 0; } catch { return false; }
};
const initialPointerDataDir = app.isPackaged ? readStoragePointer() : null;
const readManagedRoots = () => {
  try {
    const count = Number(registryValue('ManagedRootCount') || 0); const roots = [];
    for (let index = 1; index <= count; index += 1) { const root = registryValue(`ManagedRoot${index}`); if (root && path.isAbsolute(root)) roots.push(root); }
    return roots;
  } catch { return []; }
};
const rememberStorageRoot = (dataDir) => {
  const roots = [...new Set([...readManagedRoots(), path.resolve(dataDir)])];
  const countWritten = writeRegistryValue('ManagedRootCount', 'REG_SZ', String(roots.length));
  const rootsWritten = roots.every((root, index) => writeRegistryValue(`ManagedRoot${index + 1}`, 'REG_SZ', root));
  return countWritten && rootsWritten;
};
const writeStoragePointer = (dataDir) => writeRegistryValue('DataDir', 'REG_SZ', path.resolve(dataDir)) && rememberStorageRoot(dataDir);
const readPendingStorage = (dataDir) => {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dataDir, 'storage-location.json'), 'utf8')).dataDir;
    return typeof value === 'string' && path.isAbsolute(value) ? value : null;
  } catch { return null; }
};
const provisionalRuntimeBaseDir = process.env.WEKI_DATA_DIR || initialPointerDataDir || installDataDir;
const provisionalRuntimeDir = path.join(provisionalRuntimeBaseDir, '.runtime');
let activeRuntimeDir = provisionalRuntimeDir;
app.setPath('userData', provisionalRuntimeDir);
app.setPath('sessionData', path.join(provisionalRuntimeDir, 'session'));
app.setPath('logs', path.join(provisionalRuntimeDir, 'logs'));
app.setPath('crashDumps', path.join(provisionalRuntimeDir, 'crash-dumps'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

let server;
let ownsServer = false;
let quitAfterServerStop = false;
let runtimeInstallWatch = null;
let appPort = Number(process.env.WEKI_PORT || 5173);
let appUrl = `http://127.0.0.1:${appPort}`;
const packagedIconPath = path.join(__dirname, 'dist', 'app-icon.png');
const myboxCredentialState = { state: 'missing', token: null };
let activeDataDir = null;
let activeServerEnv = null;
const aiCredentialStore = async () => {
  const { createAiCredentialsStore } = await import('./src/server/ai-credentials.mjs');
  return createAiCredentialsStore({ filePath: path.join(activeDataDir, 'credentials', 'gemini-api-key.json'), safeStorage });
};
const sendStoredGeminiKeyToServer = async () => {
  if (!server || !server.connected || !activeDataDir) return false;
  let apiKey = null;
  try { apiKey = await (await aiCredentialStore()).getApiKeyForServer(); } catch {}
  const message = { type: 'weki:gemini-credential' };
  if (apiKey) message.apiKey = apiKey;
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => finish(false), 2000);
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.removeListener('message', onMessage);
      resolve(success);
    };
    const onMessage = (received) => {
      if (received?.type === 'weki-gemini-credential-applied') finish(true);
    };
    server.on('message', onMessage);
    try { server.send(message, (error) => { if (error) finish(false); }); }
    catch { finish(false); }
  });
};
const serverIsReady = async ({ dataDir = null, credentialState = null } = {}) => {
  try {
    const { response, data: status } = await requestWithTimeout(`${appUrl}/api/status`, { timeoutMs: 2_000, parseJson: true });
    if (!response.ok) return false;
    if (dataDir && path.resolve(status.dataDirectory || '').toLowerCase() !== path.resolve(dataDir).toLowerCase()) return false;
    if (credentialState) {
      const { response: credentialResponse, data: credential } = await requestWithTimeout(`${appUrl}/api/mybox/status`, { timeoutMs: 2_000, parseJson: true });
      if (!credentialResponse.ok) return false;
      if (credential.credentialState !== credentialState) return false;
    }
    return true;
  } catch { return false; }
};
const isPortAvailable = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  const finish = (available) => { try { probe.close(); } catch {} resolve(available); };
  probe.once('error', () => finish(false));
  probe.once('listening', () => finish(true));
  probe.listen(port, '127.0.0.1');
});
const findAvailablePort = async (startPort) => {
  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = startPort + offset;
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error('Weki local server port is unavailable');
};
const canWrite = (targetDir) => {
  const probe = path.join(targetDir, `.weki-write-test-${process.pid}-${Date.now()}`);
  try { fs.mkdirSync(targetDir, { recursive: true }); fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); return true; } catch { try { fs.unlinkSync(probe); } catch {} return false; }
};
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const grantStorageAccess = (targetDir) => {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const account = `${process.env.USERDOMAIN || '.'}\\${process.env.USERNAME || ''}`;
    const result = spawnSync('icacls.exe', [targetDir, '/grant', `${account}:(OI)(CI)M`, '/T', '/C'], { windowsHide: true, encoding: 'utf8' });
    return result.status === 0 && canWrite(targetDir);
  } catch { return false; }
};
const runElevatedStorageSetup = (targetDir) => {
  if (process.platform !== 'win32') return false;
  const script = `$target=${psQuote(targetDir)}; $exe=${psQuote(process.execPath)}; $args='--weki-grant-storage ' + ('"' + $target + '"'); $p=Start-Process -FilePath $exe -ArgumentList $args -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8' });
  return result.status === 0 && canWrite(targetDir);
};
const configureRuntimeStorage = (dataDir) => {
  const runtimeDir = path.join(dataDir, '.runtime');
  activeRuntimeDir = runtimeDir;
  fs.mkdirSync(runtimeDir, { recursive: true });
  app.setPath('userData', runtimeDir);
  app.setPath('sessionData', path.join(runtimeDir, 'session'));
  app.setPath('logs', path.join(runtimeDir, 'logs'));
  app.setPath('crashDumps', path.join(runtimeDir, 'crash-dumps'));
  app.commandLine.appendSwitch('disk-cache-dir', path.join(runtimeDir, 'cache'));
  if (path.resolve(runtimeDir).toLowerCase() !== path.resolve(provisionalRuntimeDir).toLowerCase()) fs.rmSync(provisionalRuntimeDir, { recursive: true, force: true });
};
const writeRuntimeRestartLog = (event) => {
  try {
    const logDir = path.join(activeRuntimeDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'runtime-restart.log'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, 'utf8');
  } catch { /* Restart diagnostics must never prevent the app from starting or quitting. */ }
};
let appStartupPhase = 'waiting-for-electron-ready';
const traceStartupPhase = (phase, details = {}) => {
  appStartupPhase = phase;
  if (isRuntimeAutoRelaunch && activeDataDir) writeRuntimeRestartLog({ type: 'startup-phase', phase, ...details });
};
const relaunchArguments = (extra = []) => [
  ...process.argv.slice(1).filter((argument) => argument !== runtimeAutoRelaunchArgument),
  ...extra,
];
const cleanupManagedStorageRoot = (rootDir, currentDir) => {
  if (!rootDir || !path.isAbsolute(rootDir) || path.resolve(rootDir).toLowerCase() === path.resolve(currentDir).toLowerCase()) return false;
  try {
    for (const entry of ['originals', 'incoming', 'backups', 'tessdata', 'credentials', '.runtime']) fs.rmSync(path.join(rootDir, entry), { recursive: true, force: true });
    for (const entry of ['knowledge-base.json', 'storage-location.json', '.weki-storage-root']) fs.rmSync(path.join(rootDir, entry), { force: true });
    if (fs.readdirSync(rootDir).length) return false;
    fs.rmdirSync(rootDir);
    return !fs.existsSync(rootDir);
  } catch { return false; }
};
const chooseAlternativeDataDir = async (defaultPath) => {
  const result = await dialog.showOpenDialog({ title: 'Weki 데이터 저장 위치 선택', defaultPath: path.dirname(defaultPath), properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  if (!canWrite(result.filePaths[0])) { await dialog.showMessageBox({ type: 'error', title: '저장 위치를 사용할 수 없습니다', message: '선택한 폴더에 Weki 데이터를 쓸 수 없습니다. 쓰기 권한을 확인하거나 다른 폴더를 선택해 주세요.' }); return null; }
  return result.filePaths[0];
};
const chooseFreshDataDir = async () => {
  if (canWrite(installDataDir)) {
    const choice = await dialog.showMessageBox({ type: 'question', title: 'Weki 데이터 저장 위치', message: `문서 원본과 검색 데이터는 다음 위치에 저장됩니다.\n\n${installDataDir}`, buttons: ['이 위치 사용', '다른 위치 선택', '종료'], defaultId: 0, cancelId: 2 });
    if (choice.response === 0) return installDataDir;
    if (choice.response === 2) return null;
    return chooseAlternativeDataDir(installDataDir);
  }
  const choice = await dialog.showMessageBox({ type: 'warning', title: '쓰기 권한이 필요합니다', message: `설치 폴더에 Weki 데이터를 저장할 수 없습니다.\n\n관리자 권한으로 ${installDataDir} 폴더의 현재 사용자 쓰기 권한을 설정하시겠습니까?`, buttons: ['관리자 권한으로 허용', '다른 위치 선택', '종료'], defaultId: 0, cancelId: 2 });
  if (choice.response === 0 && runElevatedStorageSetup(installDataDir)) return installDataDir;
  if (choice.response === 0) await dialog.showMessageBox({ type: 'error', title: '권한 설정 실패', message: '관리자 권한으로도 설치 폴더를 사용할 수 없습니다. 다른 저장 위치를 선택해 주세요.' });
  if (choice.response === 2) return null;
  return chooseAlternativeDataDir(installDataDir);
};
const loadMyboxCredential = async (dataDir) => {
  const { consumeTokenBootstrap, loadEncryptedTokenWithFallback } = await import('./src/server/mybox-credentials.mjs');
  const encryptToken = async (token) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
    return safeStorage.encryptString(token).toString('base64');
  };
  const decryptToken = async (ciphertext) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  };
  const bootstrap = await consumeTokenBootstrap(dataDir, encryptToken);
  if (bootstrap.state === 'failed') return { state: 'unreadable', token: null };
  return loadEncryptedTokenWithFallback(dataDir, [initialPointerDataDir, ...readManagedRoots()], decryptToken);
};
const restartOwnedServer = async () => {
  if (!ownsServer || !activeServerEnv) return false;
  const oldServer = server;
  if (oldServer && !oldServer.killed) {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      oldServer.once('exit', finish);
      oldServer.kill();
      setTimeout(finish, 2000);
    });
  }
  server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: activeServerEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const { waitForLocalServerReady } = await import('./src/server/ai-credentials.mjs');
  await waitForLocalServerReady(server);
  await sendStoredGeminiKeyToServer();
  return true;
};
const reloadOwnedServer = async () => {
  if (!ownsServer || !activeServerEnv) return false;
  const oldServer = server;
  if (oldServer && !oldServer.killed) {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      oldServer.once('exit', finish);
      oldServer.kill();
      setTimeout(finish, 2000);
    });
  }
  const { waitForLocalServerReady } = await import('./src/server/ai-credentials.mjs');
  server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: activeServerEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  await waitForLocalServerReady(server);
  await sendStoredGeminiKeyToServer();
  return true;
};
const stopOwnedServer = () => {
  if (!ownsServer || !server) return Promise.resolve();
  const child = server;
  server = null;
  ownsServer = false;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', finish);
      resolve();
    };
    child.once('exit', finish);
    try { child.kill(); } catch {}
    timer = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      } catch {}
      finish();
    }, 1500);
  });
};
const getAiCredentialHandlers = async () => {
  const { createAiCredentialIpcHandlers } = await import('./src/server/ai-credentials.mjs');
  return createAiCredentialIpcHandlers({ getStore: aiCredentialStore, encryptionAvailable: () => safeStorage.isEncryptionAvailable(), reloadServer: reloadOwnedServer });
};
ipcMain.handle('weki:credential-status', () => ({ state: myboxCredentialState.state, encryptionAvailable: safeStorage.isEncryptionAvailable() }));
ipcMain.handle('weki:save-mybox-token', async (_event, value) => {
  const token = String(value || '').trim();
  if (!token) return { ok: false, error: 'MYBOX 토큰을 입력해 주세요.' };
  if (!activeDataDir) return { ok: false, error: 'Weki 데이터 저장소가 준비되지 않았습니다.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Windows 보안 저장소를 사용할 수 없어 토큰을 저장할 수 없습니다.' };
  const { writeEncryptedToken } = await import('./src/server/mybox-credentials.mjs');
  const ciphertext = safeStorage.encryptString(token).toString('base64');
  await writeEncryptedToken(activeDataDir, ciphertext);
  myboxCredentialState.state = 'available';
  myboxCredentialState.token = token;
  if (activeServerEnv) { activeServerEnv.NAVER_MBOX_TOKEN = token; activeServerEnv.WEKI_MYBOX_CREDENTIAL_STATE = 'available'; }
  const applied = await restartOwnedServer();
  return { ok: true, state: 'available', applied };
});
ipcMain.handle('weki:clear-mybox-token', async () => {
  if (!activeDataDir) return { ok: false, error: 'Weki 데이터 저장소가 준비되지 않았습니다.' };
  const { clearEncryptedToken, bootstrapPath } = await import('./src/server/mybox-credentials.mjs');
  await clearEncryptedToken(activeDataDir);
  await fs.promises.rm(bootstrapPath(activeDataDir), { force: true });
  myboxCredentialState.state = 'missing';
  myboxCredentialState.token = null;
  if (activeServerEnv) { delete activeServerEnv.NAVER_MBOX_TOKEN; activeServerEnv.WEKI_MYBOX_CREDENTIAL_STATE = 'missing'; }
  const applied = await restartOwnedServer();
  return { ok: true, state: 'missing', applied };
});
ipcMain.handle('weki:gemini-credential-status', async () => (await getAiCredentialHandlers()).status());
ipcMain.handle('weki:save-gemini-key', async (_event, apiKey) => (await getAiCredentialHandlers()).save(apiKey));
ipcMain.handle('weki:clear-gemini-key', async () => (await getAiCredentialHandlers()).clear());
ipcMain.handle('weki:restart', () => {
  app.relaunch({ args: relaunchArguments() });
  app.quit();
  return { ok: true };
});
ipcMain.handle('weki:watch-runtime-install', async (_event, startedAt) => {
  if (typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) return { ok: false, reason: 'invalid-batch-start-time' };
  if (!activeDataDir || !appUrl) return { ok: false, reason: 'app-not-ready' };
  if (runtimeInstallWatch?.startedAt === startedAt) return { ok: true, alreadyWatching: true };

  runtimeInstallWatch?.controller.abort();
  const controller = new AbortController();
  const watch = { startedAt, controller, promise: null, relaunchRequested: false };
  runtimeInstallWatch = watch;
  writeRuntimeRestartLog({ type: 'watch-armed', batchStartedAt: startedAt });
  try {
    const { monitorRuntimeInstallAutoRestart } = await import('./src/runtime/auto-restart.mjs');
    watch.promise = monitorRuntimeInstallAutoRestart({
      startedAt,
      signal: controller.signal,
      getSnapshot: async () => {
        const [runtimeResponse, jobsResponse] = await Promise.all([
          fetch(`${appUrl}/api/runtime/components`),
          fetch(`${appUrl}/api/jobs`),
        ]);
        if (!runtimeResponse.ok || !jobsResponse.ok) throw new Error(`status-http-${runtimeResponse.status}-${jobsResponse.status}`);
        const [runtime, jobs] = await Promise.all([runtimeResponse.json(), jobsResponse.json()]);
        return { installBatch: runtime.installBatch, jobs: jobs.jobs };
      },
      onEvent: writeRuntimeRestartLog,
      requestRestart: async () => {
        watch.relaunchRequested = true;
        app.relaunch({ args: relaunchArguments([runtimeAutoRelaunchArgument]) });
        app.quit();
      },
    });
    void watch.promise
      .then((result) => writeRuntimeRestartLog({ type: 'watch-finished', batchStartedAt: startedAt, ...result }))
      .catch((error) => writeRuntimeRestartLog({ type: 'watch-error', batchStartedAt: startedAt, message: String(error?.message || error) }))
      .finally(() => { if (runtimeInstallWatch === watch) runtimeInstallWatch = null; });
    return { ok: true };
  } catch (error) {
    controller.abort();
    if (runtimeInstallWatch === watch) runtimeInstallWatch = null;
    writeRuntimeRestartLog({ type: 'watch-start-failed', batchStartedAt: startedAt, message: String(error?.message || error) });
    return { ok: false, reason: 'watcher-start-failed' };
  }
});
app.whenReady().then(async () => {
  try {
    if (grantStorageTarget) { app.exit(grantStorageAccess(grantStorageTarget) ? 0 : 1); return; }
    traceStartupPhase('resolve-data-directory');
    const storage = await import('./src/server/storage.mjs');
    const pointerDataDir = initialPointerDataDir;
    let electronDataDir = process.env.WEKI_DATA_DIR || (app.isPackaged ? storage.selectInitialDataDirectory({ pointerDataDir, installDataDir }) : path.join(__dirname, '.weki-data'));
    if (app.isPackaged && !process.env.WEKI_DATA_DIR && pointerDataDir) {
      const pendingDataDir = readPendingStorage(pointerDataDir);
      if (pendingDataDir && path.resolve(pendingDataDir).toLowerCase() !== path.resolve(pointerDataDir).toLowerCase()) {
        electronDataDir = pendingDataDir;
        if (!canWrite(electronDataDir)) electronDataDir = await chooseAlternativeDataDir(pendingDataDir);
        if (!electronDataDir) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '기존 저장소를 사용할 수 없습니다. 저장 위치를 다시 선택해 주세요.' }); app.quit(); return; }
        if (!writeStoragePointer(electronDataDir)) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '저장 위치 설정을 저장하지 못했습니다.' }); app.quit(); return; }
      } else if (!canWrite(pointerDataDir)) {
        electronDataDir = await chooseAlternativeDataDir(pointerDataDir);
        if (!electronDataDir) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '기존 저장소에 쓸 수 없습니다. 저장 위치를 다시 선택해 주세요.' }); app.quit(); return; }
        if (!writeStoragePointer(electronDataDir)) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '저장 위치 설정을 저장하지 못했습니다.' }); app.quit(); return; }
      }
    }
    if (app.isPackaged && !process.env.WEKI_DATA_DIR && !pointerDataDir) {
      traceStartupPhase('choose-data-directory');
      electronDataDir = await chooseFreshDataDir();
      if (!electronDataDir) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '문서 저장 위치가 선택되지 않았습니다.' }); app.quit(); return; }
      if (!writeStoragePointer(electronDataDir)) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '저장 위치 설정을 저장하지 못했습니다.' }); app.quit(); return; }
    }
    activeDataDir = electronDataDir;
    configureRuntimeStorage(electronDataDir);
    if (isRuntimeAutoRelaunch) writeRuntimeRestartLog({ type: 'auto-restart-process-started', pid: process.pid });
    traceStartupPhase('load-mybox-credential');
    const credential = await loadMyboxCredential(electronDataDir).catch(() => ({ state: 'unreadable', token: null }));
    myboxCredentialState.state = credential.state;
    myboxCredentialState.token = credential.token || null;
    traceStartupPhase('cleanup-pending-storage');
    if (app.isPackaged && pendingCleanupRoot && cleanupManagedStorageRoot(pendingCleanupRoot, electronDataDir)) deleteRegistryValue('PendingCleanupRoot');
    if (app.isPackaged && !process.env.WEKI_DATA_DIR) rememberStorageRoot(electronDataDir);
    traceStartupPhase('check-existing-server');
    const matchingServerReady = myboxCredentialState.state === 'available'
      ? await serverIsReady({ dataDir: electronDataDir, credentialState: 'available' })
      : false;
    if (!matchingServerReady) {
      traceStartupPhase('find-server-port');
      appPort = await findAvailablePort(appPort);
      appUrl = `http://127.0.0.1:${appPort}`;
      activeServerEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', WEKI_DESKTOP: '1', WEKI_DISABLE_ENV_FILE: app.isPackaged ? '1' : '0', WEKI_SEARCH_V2: process.env.WEKI_SEARCH_V2 || (app.isPackaged ? '1' : '0'), WEKI_DATA_DIR: electronDataDir, WEKI_CONFIG_PATH: path.join(electronDataDir, 'storage-location.json'), WEKI_MYBOX_CREDENTIAL_STATE: myboxCredentialState.state, WEKI_PORT: String(appPort) };
      delete activeServerEnv.WEKI_ENV_FILE;
      if (myboxCredentialState.token) activeServerEnv.NAVER_MBOX_TOKEN = myboxCredentialState.token;
      else delete activeServerEnv.NAVER_MBOX_TOKEN;
      if (!app.isPackaged) activeServerEnv.WEKI_ENV_FILE = path.join(__dirname, '.env');
      traceStartupPhase('spawn-local-server', { port: appPort });
      server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: activeServerEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true }); ownsServer = true;
      const { waitForLocalServerReady } = await import('./src/server/ai-credentials.mjs');
      traceStartupPhase('wait-local-server-ready', { pid: server.pid, port: appPort });
      await waitForLocalServerReady(server);
      traceStartupPhase('local-server-ready', { port: appPort });
    } else {
      traceStartupPhase('reuse-existing-server');
    }
    if (ownsServer) {
      traceStartupPhase('apply-gemini-credential');
      await sendStoredGeminiKeyToServer();
    }
    traceStartupPhase('create-window');
    const window = new BrowserWindow({ width: 1360, height: 900, minWidth: 1024, minHeight: 700, title: 'Weki', icon: fs.existsSync(packagedIconPath) ? packagedIconPath : undefined, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'src', 'preload.cjs') } });
    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isRuntimeAutoRelaunch && isMainFrame) writeRuntimeRestartLog({ type: 'window-load-failed', errorCode, errorDescription });
    });
    traceStartupPhase('load-window');
    await window.loadURL(`${appUrl}/`);
    traceStartupPhase('window-loaded');
  } catch (error) {
    const message = String(error?.message || error);
    writeRuntimeRestartLog({ type: 'startup-failed', phase: appStartupPhase, message });
    try {
      await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: `Weki 시작 중 문제가 발생했습니다.\n단계: ${appStartupPhase}\n${message}` });
    } catch {}
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (runtimeInstallWatch) {
    const watch = runtimeInstallWatch;
    watch.controller.abort();
    if (!watch.relaunchRequested) writeRuntimeRestartLog({ type: 'watch-cancelled', batchStartedAt: watch.startedAt });
    runtimeInstallWatch = null;
  }
  if (quitAfterServerStop || !ownsServer || !server) return;
  event.preventDefault();
  quitAfterServerStop = true;
  stopOwnedServer().finally(() => app.quit());
});
app.on('will-quit', () => {
  if (ownsServer && server && !server.killed) server.kill();
  if (path.resolve(activeRuntimeDir).toLowerCase() !== path.resolve(provisionalRuntimeDir).toLowerCase()) fs.rmSync(provisionalRuntimeDir, { recursive: true, force: true });
});
