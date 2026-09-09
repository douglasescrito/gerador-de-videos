export async function nanoBananaMotionDocument(scene) {
  for (const dimension of [scene.width, scene.height]) if (!Number.isInteger(dimension) || dimension < 64 || dimension > 4096) throw new Error('Scanner dimensions must be integers from 64 to 4096.');
  if (scene.width !== scene.height) throw new Error('Scanner requires a square canvas.');
  if (!Number.isFinite(scene.fps) || scene.fps <= 0 || !Number.isFinite(scene.durationSeconds) || scene.durationSeconds <= 0) throw new Error('Scanner duration and fps must be positive.');
  const imageDataUri = scene.scannerImageDataUri ?? null;
  if (imageDataUri !== null && (typeof imageDataUri !== 'string' || imageDataUri.length > 20_000_000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUri))) throw new Error('Scanner image must be an embedded PNG or JPEG.');
  const copy = {header:'SCANNER / DEMO',title:'OBJETO DE ESTUDO',result:'LEITURA VISUAL',...scene.scannerCopy};
  for (const [key,value] of Object.entries(copy)) if (!['header','title','result'].includes(key) || typeof value !== 'string' || value.length > 48) throw new Error('Scanner copy is invalid.');
  const settings = JSON.stringify({imageDataUri,copy}).replaceAll('<','\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: ${scene.width}px; height: ${scene.height}px; overflow: hidden; background: #030712; font-family: Arial, sans-serif; }
  canvas { display: block; width: 100%; height: 100%; }

</style>
</head>
<body>

<canvas id="c" width="${scene.width}" height="${scene.height}"></canvas>
<script>(()=>{
const c = document.getElementById('c'), g = c.getContext('2d');
const W = c.width, H = c.height;
const settings = ${settings};
const img = settings.imageDataUri ? new Image() : null;
if (img) img.src = settings.imageDataUri;

const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const out = x => 1 - Math.pow(1 - clamp(x), 4);

function txt(s, x, y, size = 18, col = '#00f0ff', align = 'left', weight = 700) {
  g.fillStyle = col;
  g.font = weight + ' ' + size + 'px Arial, monospace, sans-serif';
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function rr(x, y, w, h, r = 8, col = null, border = null, bw = 1.5) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (col) { g.fillStyle = col; g.fill(); }
  if (border) { g.strokeStyle = border; g.lineWidth = bw; g.stroke(); }
}

function circle(x, y, r, col = null, border = null, bw = 1.5) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (col) { g.fillStyle = col; g.fill(); }
  if (border) { g.strokeStyle = border; g.lineWidth = bw; g.stroke(); }
}

function line(x, y, X, Y, col = '#00f0ff', width = 1.5) {
  g.strokeStyle = col;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(X, Y);
  g.stroke();
}

function glow(x, y, r, col) {
  let a = g.createRadialGradient(x, y, 0, x, y, r);
  a.addColorStop(0, col);
  a.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = a;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawTargetBracket(x, y, size, col = '#00f0ff') {
  const len = size * 0.35;
  g.strokeStyle = col;
  g.lineWidth = 2;
  // Top-Left
  g.beginPath(); g.moveTo(x - size, y - size + len); g.lineTo(x - size, y - size); g.lineTo(x - size + len, y - size); g.stroke();
  // Top-Right
  g.beginPath(); g.moveTo(x + size - len, y - size); g.lineTo(x + size, y - size); g.lineTo(x + size, y - size + len); g.stroke();
  // Bottom-Left
  g.beginPath(); g.moveTo(x - size, y + size - len); g.lineTo(x - size, y + size); g.lineTo(x - size + len, y + size); g.stroke();
  // Bottom-Right
  g.beginPath(); g.moveTo(x + size - len, y + size); g.lineTo(x + size, y + size); g.lineTo(x + size, y + size - len); g.stroke();
}

function draw(t) {
  g.setTransform(W / 1080, 0, 0, H / 1080, 0, 0);
  g.fillStyle = '#030712';
  g.fillRect(0, 0, 1080, 1080);

  // 1. Dynamic Camera Push-In and Parallax
  const p = t / 6.0;
  const zoom = 1.05 + 0.14 * ease(p);
  const panX = Math.sin(t * 0.7) * 18;
  const panY = Math.cos(t * 0.5) * 12;

  g.save();
  g.translate(540 + panX, 540 + panY);
  g.scale(zoom, zoom);

  // Render a supplied image or a neutral procedural object.
  if (img && img.naturalWidth > 0) {
    const fit = Math.min(1080 / img.naturalWidth, 1080 / img.naturalHeight);
    g.drawImage(img, -img.naturalWidth * fit / 2, -img.naturalHeight * fit / 2, img.naturalWidth * fit, img.naturalHeight * fit);
  } else if (!img) {
    glow(0, 0, 400, 'rgba(0,240,255,0.25)');
    for (let ring = 0; ring < 6; ring++) {
      g.save();g.rotate(t * .08 + ring * .27);
      rr(-220 + ring * 12, -220 + ring * 12, 440 - ring * 24, 440 - ring * 24, 45, 'rgba(3,7,18,0.25)', ring % 2 ? '#f59e0b' : '#00f0ff', 3);g.restore();
    }
  }
  g.restore();

  // 2. Cybernetic Laser Scanner Sweep
  const scanCycle = (t % 2.5) / 2.5; // 0 to 1
  const scanY = 180 + scanCycle * 720;
  const scanX = 220 + scanCycle * 640;

  // Laser beam glow
  g.save();
  glow(scanX, scanY, 140, 'rgba(0, 240, 255, 0.35)');
  line(scanX - 550, scanY - 260, scanX + 550, scanY + 260, '#00f0ff', 3);
  line(scanX - 550, scanY - 260, scanX + 550, scanY + 260, '#ffffff', 1.5);
  // Scan coordinate label
  txt('SCANLINE // LAT:' + (scanY).toFixed(1) + ' nm // ACTIVE', scanX - 180, scanY - 14, 11, '#38bdf8', 'left', 700);
  g.restore();

  // 3. Animated tracking reticles
  // Upper Reticle (Top-Right: ~830, 270)
  const stemAngle = t * 2.0;
  g.save();
  g.translate(815 + panX * 0.6, 280 + panY * 0.6);
  drawTargetBracket(0, 0, 36, '#f59e0b');
  g.rotate(stemAngle);
  circle(0, 0, 22, null, '#f59e0b', 1.5);
  line(-22, 0, 22, 0, '#f59e0b', 1);
  line(0, -22, 0, 22, '#f59e0b', 1);
  g.restore();
  txt('PONTO A [ATIVO]', 720, 210, 12, '#f59e0b', 'center', 700);

  // Main Core Reticle (Center: ~540, 520)
  g.save();
  g.translate(535 + panX * 0.8, 520 + panY * 0.8);
  drawTargetBracket(0, 0, 58, '#00f0ff');
  circle(0, 0, 34, null, '#00f0ff', 2);
  // Blinking sub-cross
  if (Math.sin(t * 12) > 0) {
    line(-18, 0, 18, 0, '#00f0ff', 2);
    line(0, -18, 0, 18, '#00f0ff', 2);
  }
  g.restore();
  rr(420, 595, 230, 38, 8, 'rgba(3,7,18,0.75)', '#00f0ff', 1.5);
  txt('OBJETO // REGIÃO CENTRAL', 535, 614, 13, '#00f0ff', 'center', 800);

  // Tip Apex Reticle (~230, 570)
  g.save();
  g.translate(230 + panX * 0.5, 570 + panY * 0.5);
  drawTargetBracket(0, 0, 30, '#10b981');
  circle(0, 0, 18, null, '#10b981', 1.5);
  g.restore();
  txt('PONTO B: ATIVO', 230, 620, 11, '#10b981', 'center', 700);

  // 4. Holographic HUD Overlays & Telemetry
  // Top Header Banner
  rr(40, 40, 1000, 65, 14, 'rgba(3,7,18,0.75)', 'rgba(0,240,255,0.3)', 1.5);
  // Blinking REC dot
  const recBlink = Math.sin(t * 6) > 0;
  circle(70, 72, 7, recBlink ? '#ef4444' : '#475569');
  txt('REC', 92, 72, 14, recBlink ? '#ef4444' : '#64748b', 'left', 800);
  txt('00:00:0' + Math.min(6, Math.floor(t)) + ':' + String(Math.floor((t % 1) * 60)).padStart(2, '0'), 135, 72, 14, '#f8fafc', 'left', 700);

  txt(settings.copy.header, 540, 72, 16, '#00f0ff', 'center', 800);
  txt('MODO: DEMONSTRAÇÃO', 1000, 72, 13, '#10b981', 'right', 700);

  // Bottom-Left Telemetry Panel
  rr(40, 850, 440, 180, 16, 'rgba(3,7,18,0.85)', 'rgba(0,240,255,0.4)', 1.5);
  txt('TELEMETRIA ILUSTRATIVA', 65, 880, 14, '#38bdf8', 'left', 800);
  
  // First gauge
  txt('SINAL A:', 65, 915, 12, '#94a3b8', 'left', 600);
  rr(215, 908, 190, 14, 4, '#1e293b');
  const kProg = 0.85 + 0.14 * Math.sin(t * 3);
  rr(215, 908, 190 * kProg, 14, 4, '#f59e0b');
  txt('99.8%', 415, 915, 12, '#f59e0b', 'left', 700);

  // Second gauge
  txt('SINAL B:', 65, 948, 12, '#94a3b8', 'left', 600);
  rr(215, 941, 190, 14, 4, '#1e293b');
  rr(215, 941, 190 * 0.94, 14, 4, '#00f0ff');
  txt('4.2 THz', 415, 948, 12, '#00f0ff', 'left', 700);

  // Third gauge
  txt('SINAL C:', 65, 981, 12, '#94a3b8', 'left', 600);
  rr(215, 974, 190, 14, 4, '#1e293b');
  rr(215, 974, 190, 14, 4, '#10b981');
  txt('100.0%', 415, 981, 12, '#10b981', 'left', 700);

  // Bottom-Right Audio / Frequency Monitor
  rr(600, 850, 440, 180, 16, 'rgba(3,7,18,0.85)', 'rgba(0,240,255,0.4)', 1.5);
  txt('ESPECTRO ILUSTRATIVO', 625, 880, 14, '#38bdf8', 'left', 800);
  // Equalizer spectrum bars
  for (let i = 0; i < 24; i++) {
    const barH = 20 + Math.sin(t * 10 + i * 0.6) * 35 + Math.cos(t * 14 + i * 0.9) * 20;
    const hClamped = Math.max(8, Math.min(85, barH));
    const bx = 625 + i * 16;
    const by = 995 - hClamped;
    rr(bx, by, 10, hClamped, 3, i % 2 === 0 ? '#00f0ff' : '#38bdf8');
  }

  // 5. Kinetic Hologram Title Center
  if (t >= 0.4 && t < 3.2) {
    const titP = out(clamp((t - 0.4) / 0.5));
    g.save();
    g.translate(540, 180);
    g.scale(titP, titP);
    rr(-180, -30, 360, 60, 12, 'rgba(3,7,18,0.85)', '#00f0ff', 2);
    txt(settings.copy.title, 0, 0, 24, '#00f0ff', 'center', 900);
    g.restore();
  } else if (t >= 3.2) {
    const titP = out(clamp((t - 3.2) / 0.5));
    g.save();
    g.translate(540, 180);
    g.scale(titP, titP);
    rr(-240, -30, 480, 60, 12, 'rgba(3,7,18,0.85)', '#10b981', 2);
    txt(settings.copy.result, 0, 0, 22, '#34d399', 'center', 900);
    g.restore();
  }

  // Corner HUD Brackets
  drawTargetBracket(70, 70, 30, 'rgba(0,240,255,0.6)');
  drawTargetBracket(1010, 70, 30, 'rgba(0,240,255,0.6)');
  drawTargetBracket(70, 1010, 30, 'rgba(0,240,255,0.6)');
  drawTargetBracket(1010, 1010, 30, 'rgba(0,240,255,0.6)');
}

const imageReady = img ? img.decode() : Promise.resolve();
window.__setFrame = async (frame) => { await imageReady; draw(frame / ${scene.fps} * 6 / ${scene.durationSeconds}); };
})();</script></body></html>`;
}
