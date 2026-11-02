// Captures each .scene in features.html as a PNG. Usage: electron site/video/shots.cjs <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = path.resolve(process.argv[2] || 'shots');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1320, height: 760, show: false, useContentSize: true });
  await win.loadFile(path.join(__dirname, 'features.html'));
  await new Promise(r => setTimeout(r, 500));
  const rects = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.scene')].map(e=>{const r=e.getBoundingClientRect();return {id:e.id,x:0,y:Math.round(r.top+scrollY),width:1280,height:720}})`);
  for (const r of rects) {
    await win.webContents.executeJavaScript(`window.scrollTo(0,${r.y})`);
    await new Promise(res => setTimeout(res, 250));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 720 });
    fs.writeFileSync(path.join(out, `${r.id}.png`), img.toPNG());
  }
  app.quit();
});
