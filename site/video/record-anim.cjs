// Renders every scene in anim.html frame by frame. Usage: electron site/video/record-anim.cjs <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = path.resolve(process.argv[2] || 'frames');
const FPS = 30;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1320, height: 760, show: false, useContentSize: true });
  await win.loadFile(path.join(__dirname, 'anim.html'));
  const names = await win.webContents.executeJavaScript('window.names');
  const durs = await win.webContents.executeJavaScript('window.durs');
  for (const name of names) {
    const dir = path.join(out, name);
    fs.mkdirSync(dir, { recursive: true });
    await win.webContents.executeJavaScript(`setScene(${JSON.stringify(name)})`);
    await new Promise(r => setTimeout(r, 200));
    const n = Math.round(durs[name] * FPS);
    for (let i = 0; i < n; i++) {
      await win.webContents.executeJavaScript(`setT(${i / FPS})`);
      await new Promise(r => setTimeout(r, 25));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 720 });
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.png`), img.toPNG());
    }
  }
  app.quit();
});
