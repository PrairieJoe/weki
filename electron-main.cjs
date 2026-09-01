const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronDataDir = path.join(app.getPath('temp'), 'Weki-electron');
fs.mkdirSync(electronDataDir, { recursive: true });
app.setPath('userData', electronDataDir);
app.commandLine.appendSwitch('disk-cache-dir', path.join(electronDataDir, 'cache'));

let server;
let ownsServer = false;
const serverIsReady = async () => { try { return (await fetch('http://127.0.0.1:5173/api/status')).ok; } catch { return false; } };
const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch('http://127.0.0.1:5173/api/status'); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Weki local server did not start');
};
app.whenReady().then(async () => {
  if (!(await serverIsReady())) { server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore', windowsHide: true }); ownsServer = true; }
  await waitForServer();
  const window = new BrowserWindow({ width: 1360, height: 900, minWidth: 1024, minHeight: 700, title: 'Weki', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('http://127.0.0.1:5173/');
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (ownsServer && server && !server.killed) server.kill(); });
