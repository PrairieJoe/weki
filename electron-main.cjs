const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
const appPort = Number(process.env.WEKI_PORT || 5173);
const appUrl = `http://127.0.0.1:${appPort}`;
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
  return new Promise((resolve) => {
    try { server.send({ type: 'weki:gemini-credential', apiKey }, (error) => resolve(!error)); }
    catch { resolve(false); }
  });
};
const serverIsReady = async () => { try { return (await fetch(`${appUrl}/api/status`)).ok; } catch { return false; } };
const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`${appUrl}/api/status`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Weki local server did not start');
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
  const { consumeTokenBootstrap, loadEncryptedToken } = await import('./src/server/mybox-credentials.mjs');
  const encryptToken = async (token) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
    return safeStorage.encryptString(token).toString('base64');
  };
  const decryptToken = async (ciphertext) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 보안 저장소를 사용할 수 없습니다.');
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  };
  const bootstrap = await consumeTokenBootstrap(dataDir, encryptToken);
  const stored = await loadEncryptedToken(dataDir, decryptToken);
  if (bootstrap.state === 'failed') return { state: 'unreadable', token: null };
  return stored;
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
  await waitForServer();
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
  app.relaunch();
  app.exit(0);
  return { ok: true };
});
app.whenReady().then(async () => {
  if (grantStorageTarget) { app.exit(grantStorageAccess(grantStorageTarget) ? 0 : 1); return; }
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
    electronDataDir = await chooseFreshDataDir();
    if (!electronDataDir) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '문서 저장 위치가 선택되지 않았습니다.' }); app.quit(); return; }
    if (!writeStoragePointer(electronDataDir)) { await dialog.showMessageBox({ type: 'error', title: 'Weki를 시작할 수 없습니다', message: '저장 위치 설정을 저장하지 못했습니다.' }); app.quit(); return; }
  }
  activeDataDir = electronDataDir;
  configureRuntimeStorage(electronDataDir);
  const credential = await loadMyboxCredential(electronDataDir).catch(() => ({ state: 'unreadable', token: null }));
  myboxCredentialState.state = credential.state;
  myboxCredentialState.token = credential.token || null;
  if (app.isPackaged && pendingCleanupRoot && cleanupManagedStorageRoot(pendingCleanupRoot, electronDataDir)) deleteRegistryValue('PendingCleanupRoot');
  if (app.isPackaged && !process.env.WEKI_DATA_DIR) rememberStorageRoot(electronDataDir);
  if (!(await serverIsReady())) {
    activeServerEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', WEKI_DESKTOP: '1', WEKI_DISABLE_ENV_FILE: app.isPackaged ? '1' : '0', WEKI_SEARCH_V2: process.env.WEKI_SEARCH_V2 || (app.isPackaged ? '1' : '0'), WEKI_DATA_DIR: electronDataDir, WEKI_CONFIG_PATH: path.join(electronDataDir, 'storage-location.json'), WEKI_MYBOX_CREDENTIAL_STATE: myboxCredentialState.state, WEKI_PORT: String(appPort) };
    delete activeServerEnv.WEKI_ENV_FILE;
    if (myboxCredentialState.token) activeServerEnv.NAVER_MBOX_TOKEN = myboxCredentialState.token;
    else delete activeServerEnv.NAVER_MBOX_TOKEN;
    if (!app.isPackaged) activeServerEnv.WEKI_ENV_FILE = path.join(__dirname, '.env');
    server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: activeServerEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true }); ownsServer = true;
  }
  await waitForServer();
  if (ownsServer) await sendStoredGeminiKeyToServer();
  const window = new BrowserWindow({ width: 1360, height: 900, minWidth: 1024, minHeight: 700, title: 'Weki', icon: fs.existsSync(packagedIconPath) ? packagedIconPath : undefined, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'src', 'preload.cjs') } });
  await window.loadURL(`${appUrl}/`);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (ownsServer && server && !server.killed) server.kill();
  if (path.resolve(activeRuntimeDir).toLowerCase() !== path.resolve(provisionalRuntimeDir).toLowerCase()) fs.rmSync(provisionalRuntimeDir, { recursive: true, force: true });
});
