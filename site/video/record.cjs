// Renders scene.html frame by frame with Electron, then run ffmpeg (see README in output).
// Usage: node_modules/.bin/electron site/video/record.cjs <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = path.resolve(process.argv[2] || 'frames');
const FPS = 30, SECONDS = 13;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1280, height: 720, show: false, useContentSize: true, webPreferences: { offscreen: false } });
  await win.loadFile(path.join(__dirname, 'scene.html'));
  win.webContents.setZoomFactor(1);
  for (let i = 0; i < FPS * SECONDS; i++) {
    await win.webContents.executeJavaScript(`setT(${i / FPS})`);
    await new Promise(r => setTimeout(r, 30));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `f${String(i).padStart(4, '0')}.png`), img.toPNG());
  }
  app.quit();
});
