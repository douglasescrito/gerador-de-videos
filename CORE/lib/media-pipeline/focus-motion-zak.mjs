export const DEFAULT_QUADRANT_COPY=Object.freeze({
  "text0": "PAINEL DE EXEMPLO",
  "text1": "NOVA ATUALIZAÇÃO",
  "text2": "Informação em movimento",
  "text3": "E",
  "text4": "Equipe de exemplo",
  "text5": "Seu projeto está pronto!",
  "text6": "Vamos conferir os detalhes.",
  "text7": "EXPLORE",
  "text8": "CONSTRUA",
  "text9": "IDEIAS EM MOVIMENTO",
  "text10": "UM PASSO POR VEZ",
  "text11": "✓ ETAPA CONCLUÍDA",
  "text12": "CINCO ELEMENTOS",
  "text13": "Composição em camadas",
  "text14": "ETAPA PENDENTE",
  "text15": "Revise os próximos passos",
  "text16": "ETAPA CONCLUÍDA",
  "text17": "Continue o seu projeto",
  "text18": "ATIVIDADE RECENTE",
  "text19": "Atualização disponível",
  "text20": "Confira o próximo passo",
  "text21": "Arquivo preparado",
  "text22": "Primeira etapa concluída",
  "text23": "Revisão concluída",
  "text24": "Segunda etapa concluída",
  "text25": "Projeto organizado",
  "text26": "Pronto para continuar",
  "text27": "PLAYER DE EXEMPLO",
  "text28": "PLAYER",
  "text29": "Faixa de demonstração",
  "text30": "Coleção de exemplo",
  "text31": "PASSO A PASSO,",
  "text32": "EXPLORE",
  "text33": "POSSIBILIDADES",
  "text34": "DO SEU PROJETO",
  "text35": "SEU",
  "text36": "PROJETO",
  "text37": "IDEIAS QUE GANHAM MOVIMENTO.",
  "text38": "CONTINUAR",
  "text39": "Demonstração de componentes visuais"
});

export async function focusMotionZakDocument(scene) {
  if (![scene.width,scene.height].every(v=>Number.isInteger(v)&&v>=64&&v<=4096)||scene.width!==scene.height) throw new Error('Quadrants require a square canvas from 64 to 4096 pixels.');
  if (!Number.isFinite(scene.fps)||scene.fps<=0||scene.durationSeconds!==14.5) throw new Error('Quadrants require 14.5 seconds and positive fps.');
  const logoDataUri=scene.quadrantLogoDataUri??null;
  if(logoDataUri!==null&&(typeof logoDataUri!=='string'||logoDataUri.length>20_000_000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(logoDataUri)))throw new Error('Logo must be an embedded PNG or JPEG.');
  const copy={...DEFAULT_QUADRANT_COPY,...scene.quadrantCopy};
  for(const [key,value] of Object.entries(copy))if(!(key in DEFAULT_QUADRANT_COPY)||typeof value!=='string'||value.length>80)throw new Error('Quadrant copy is invalid.');
  const settings=JSON.stringify({logoDataUri,copy}).replaceAll('<','\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: ${scene.width}px; height: ${scene.height}px; overflow: hidden; background: #080a10; }
  canvas { display: block; width: 100%; height: 100%; }

</style>
</head>
<body>

<canvas id="c" width="${scene.width}" height="${scene.height}"></canvas>
<script>(()=>{
const c = document.getElementById('c'), g = c.getContext('2d');
const W = c.width, H = c.height;
const settings=${settings};
const logoImg=settings.logoDataUri?new Image():null;
if(logoImg)logoImg.src=settings.logoDataUri;

const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const out = x => 1 - Math.pow(1 - clamp(x), 4);
const bounce = x => {
  x = clamp(x);
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const spring = x => {
  x = clamp(x);
  return 1 - Math.cos(x * Math.PI * 3.5) * Math.exp(-x * 5);
};

function txt(s, x, y, size = 30, col = '#111', align = 'center', weight = 700) {
  g.fillStyle = col;
  g.font = weight + ' ' + size + 'px Arial, sans-serif';
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function rr(x, y, w, h, r = 20, col = '#fff', border = null, bw = 2) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (col) { g.fillStyle = col; g.fill(); }
  if (border) { g.strokeStyle = border; g.lineWidth = bw; g.stroke(); }
}

function circle(x, y, r, col = '#fff', border = null, bw = 2) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (col) { g.fillStyle = col; g.fill(); }
  if (border) { g.strokeStyle = border; g.lineWidth = bw; g.stroke(); }
}

function line(x, y, X, Y, col = '#e0e0e0', width = 2) {
  g.strokeStyle = col;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(X, Y);
  g.stroke();
}

function shadow(f, blur = 24, col = 'rgba(0,0,0,0.18)', ox = 0, oy = 10) {
  g.save();
  g.shadowColor = col;
  g.shadowBlur = blur;
  g.shadowOffsetX = ox;
  g.shadowOffsetY = oy;
  f();
  g.restore();
}

function glow(x, y, r, col) {
  let a = g.createRadialGradient(x, y, 0, x, y, r);
  a.addColorStop(0, col);
  a.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = a;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawGenericMark(cx,cy,s,col='#0048C0') {
  g.save();g.translate(cx,cy);
  for(let i=0;i<4;i++){const a=i*Math.PI/2;circle(Math.cos(a)*s*.32,Math.sin(a)*s*.32,s*.18,col);}
  g.restore();
}

function drawLaptopPerson(cx, cy, s, t) {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);

  circle(0, -60, 44, '#5c3826'); // hair
  circle(0, -52, 38, '#935838'); // face

  const blink = Math.sin(t * 8) > 0.95 ? 1 : 0;
  if (blink) {
    line(-16, -55, -6, -55, '#221108', 3);
    line(6, -55, 16, -55, '#221108', 3);
  } else {
    circle(-11, -55, 6, '#221108');
    circle(11, -55, 6, '#221108');
    circle(-10, -57, 2, '#fff');
    circle(12, -57, 2, '#fff');
  }

  g.fillStyle = '#0048C0';
  g.beginPath();
  g.roundRect(-55, -15, 110, 60, 20);
  g.fill();

  shadow(() => {
    rr(-68, -35, 136, 90, 8, '#d4d8df', '#a0a6b2', 2);

    rr(-63, -31, 126, 75, 4, '#1c1f26');

    for (let i = 0; i < 4; i++) {
      let lw = 40 + ((i * 17) % 50);
      rr(-55, -22 + i * 14, lw, 6, 2, i === 0 ? '#00D4FF' : '#5b6982');
    }
  }, 16, 'rgba(0,0,0,0.25)', 0, 8);

  rr(-75, 52, 150, 8, 4, '#b0b6c2');
  g.restore();
}




function drawQ1(t) {
  g.save();

  rr(24, 24, 492, 492, 32, '#FFFFFF', '#f0f3f8', 2);
  g.beginPath();
  g.roundRect(24, 24, 492, 492, 32);
  g.clip();

  txt(settings.copy.text0, 270, 60, 16, '#94a3b8', 'center', 700);

  if (t < 2.8) {

    const p = out(t / 1.4);
    const badgeScale = 0.5 + 0.5 * spring(Math.min(1, t / 0.8));
    g.save();
    g.translate(270, 240);
    g.scale(badgeScale, badgeScale);

    shadow(() => {
      rr(-65, -65, 130, 130, 36, '#22c55e');
    }, 25, 'rgba(34,197,94,0.35)', 0, 12);

    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.ellipse(0, -4, 42, 32, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-15, 20);
    g.lineTo(-28, 38);
    g.lineTo(-2, 26);
    g.fill();

    let countNum = Math.floor(clamp(t / 1.8) * 89);
    shadow(() => {
      circle(48, -48, 28, '#ef4444');
    }, 12, 'rgba(239,68,68,0.4)');
    txt(String(countNum), 48, -48, 22, '#FFFFFF', 'center', 800);
    g.restore();

    const textP = out(clamp((t - 0.5) / 0.6));
    g.save();
    g.globalAlpha = textP;
    g.translate(0, (1 - textP) * 20);
    txt(settings.copy.text1, 270, 370, 24, '#0f172a', 'center', 800);
    txt(settings.copy.text2, 270, 404, 18, '#64748b', 'center', 600);
    g.restore();
  }
  else if (t < 6.8) {

    const modalP = out(clamp((t - 2.8) / 0.5));
    g.save();
    g.translate(270, 270);
    g.scale(0.85 + 0.15 * modalP, 0.85 + 0.15 * modalP);
    g.globalAlpha = modalP;

    shadow(() => {
      rr(-190, -170, 380, 340, 28, '#1e2430');
    }, 28, 'rgba(0,0,0,0.22)', 0, 14);

    rr(-190, -170, 380, 60, [28, 28, 0, 0], '#171c26');
    circle(-145, -140, 16, '#0055ff');
    txt(settings.copy.text3, -145, -140, 18, '#fff', 'center', 800);
    txt(settings.copy.text4, -115, -140, 17, '#f8fafc', 'left', 700);

    if (t >= 3.2) {
      const b1 = out(clamp((t - 3.2) / 0.4));
      g.save();
      g.globalAlpha = b1;
      g.translate((1 - b1) * -30, 0);
      rr(-170, -85, 270, 52, 18, '#2e384d');
      txt(settings.copy.text5, -155, -59, 16, '#f1f5f9', 'left', 600);
      g.restore();
    }

    if (t >= 4.4) {
      const b2 = out(clamp((t - 4.4) / 0.4));
      g.save();
      g.globalAlpha = b2;
      g.translate((1 - b2) * 30, 0);
      shadow(() => {
        rr(-60, -15, 230, 52, 18, '#0055ff');
      }, 15, 'rgba(0,85,255,0.3)');
      txt(settings.copy.text6, -45, 11, 16, '#ffffff', 'left', 700);
      g.restore();
    }

    if (t >= 5.3) {
      const b3 = spring(clamp((t - 5.3) / 0.4));
      g.save();
      g.translate(145, 45);
      g.scale(b3, b3);
      circle(0, 0, 20, '#ffffff');
      txt('⭐', 0, 0, 20, '#000', 'center');
      g.restore();
    }
    g.restore();
  }
  else {

    const pKinetic = out(clamp((t - 6.8) / 0.5));
    const word = t < 9.0 ? settings.copy.text7 : settings.copy.text8;
    const sub = t < 9.0 ? settings.copy.text9 : settings.copy.text10;
    g.save();
    g.translate(270, 250);
    g.scale(pKinetic, pKinetic);
    shadow(() => {
      rr(-190, -90, 380, 180, 24, '#0f172a');
    }, 24, 'rgba(15,23,42,0.25)');
    txt(word, 0, -18, 56, '#00D4FF', 'center', 900);
    txt(sub, 0, 42, 20, '#f8fafc', 'center', 700);
    g.restore();

    const pCheck = out(clamp((t - 9.4) / 0.4));
    g.save();
    g.globalAlpha = pCheck;
    rr(100, 395, 340, 56, 28, '#ecfdf5', '#10b981', 2);
    txt(settings.copy.text11, 270, 423, 17, '#047857', 'center', 800);
    g.restore();
  }
  g.restore();
}




function drawQ2(t) {
  g.save();
  const isDarkPhase = t < 2.5;
  rr(564, 24, 492, 492, 32, isDarkPhase ? '#0a0d14' : '#FFFFFF', '#f0f3f8', 2);
  g.beginPath();
  g.roundRect(564, 24, 492, 492, 32);
  g.clip();

  if (t < 2.5) {

    const pulse = 0.85 + 0.18 * Math.sin(t * 7);
    glow(810, 270, 140, 'rgba(0,180,255,0.25)');
    circle(810, 270, 72 * pulse, '#FFFFFF');

    drawGenericMark(810, 270, 44 * pulse, '#0048C0');
  }
  else if (t < 6.5) {

    const p = out(clamp((t - 2.5) / 0.5));
    g.save();
    g.translate(810, 210);
    g.scale(p, p);
    glow(0, 0, 130, 'rgba(0,85,255,0.18)');
    drawGenericMark(0, 0, 110, '#0048C0');
    g.restore();

    const starP = out(clamp((t - 3.2) / 0.5));
    g.save();
    g.globalAlpha = starP;
    txt('★★★★★', 810, 325, 34, '#f59e0b', 'center', 800);
    txt(settings.copy.text12, 810, 375, 32, '#002B80', 'center', 900);
    txt(settings.copy.text13, 810, 415, 17, '#64748b', 'center', 600);
    g.restore();
  }
  else {

    if (t < 9.0) {

      const shake = Math.sin(t * 40) * Math.max(0, 1 - (t - 6.5) / 0.5) * 8;
      g.save();
      g.translate(810 + shake, 270);
      shadow(() => {
        rr(-180, -130, 360, 260, 28, '#fff', '#fee2e2', 3);
      }, 20, 'rgba(239,68,68,0.18)');

      circle(0, -35, 54, '#fee2e2');
      circle(0, -35, 42, '#ef4444');
      txt('✕', 0, -33, 44, '#ffffff', 'center', 900);
      txt(settings.copy.text14, 0, 45, 24, '#991b1b', 'center', 800);
      txt(settings.copy.text15, 0, 80, 17, '#b91c1c', 'center', 600);
      g.restore();
    } else {

      const pCheck = spring(clamp((t - 9.0) / 0.6));
      g.save();
      g.translate(810, 270);
      g.scale(pCheck, pCheck);
      shadow(() => {
        rr(-180, -130, 360, 260, 28, '#0f172a', '#38bdf8', 2);
      }, 25, 'rgba(56,189,248,0.3)');

      circle(0, -35, 56, '#064e3b');
      circle(0, -35, 44, '#10b981');
      txt('✓', 0, -33, 46, '#ffffff', 'center', 900);
      txt(settings.copy.text16, 0, 45, 25, '#38bdf8', 'center', 900);
      txt(settings.copy.text17, 0, 82, 17, '#f8fafc', 'center', 600);
      g.restore();
    }
  }
  g.restore();
}




function drawQ3(t) {
  g.save();
  rr(24, 564, 492, 492, 32, '#FFFFFF', '#f0f3f8', 2);
  g.beginPath();
  g.roundRect(24, 564, 492, 492, 32);
  g.clip();

  txt(settings.copy.text18, 270, 600, 16, '#94a3b8', 'center', 700);

  if (t < 6.2) {

    const guyP = out(clamp(t / 0.8));
    g.save();
    g.translate(0, (1 - guyP) * 60);
    drawLaptopPerson(270, 840, 1.2, t);
    g.restore();

    if (t >= 1.2) {
      const popP = spring(clamp((t - 1.2) / 0.5));
      g.save();
      g.translate(270, 690);
      g.scale(popP, popP);
      shadow(() => {
        circle(0, 0, 36, '#25D366');
      }, 18, 'rgba(37,211,102,0.35)');
      txt('💬', 0, 0, 32, '#fff', 'center');

      circle(25, -25, 14, '#ef4444');
      txt('1', 25, -25, 15, '#fff', 'center', 800);
      g.restore();
    }

    if (t >= 3.2) {

      const discP = out(clamp((t - 3.2) / 0.4));
      g.save();
      g.translate(270, 710);
      g.scale(discP, discP);
      shadow(() => {
        rr(-180, -40, 360, 80, 20, '#1e293b');
      }, 20, 'rgba(0,0,0,0.2)');
      circle(-140, 0, 22, '#0055ff');
      txt('🎓', -140, 0, 20, '#fff', 'center');
      txt(settings.copy.text19, -105, -12, 17, '#f8fafc', 'left', 700);
      txt(settings.copy.text20, -105, 14, 14, '#94a3b8', 'left', 500);
      g.restore();
    }
  }
  else {

    const pills = [
      { title: settings.copy.text21, sub: settings.copy.text22, icon: '💼', col: '#3b82f6', start: 6.2 },
      { title: settings.copy.text23, sub: settings.copy.text24, icon: '📈', col: '#10b981', start: 7.4 },
      { title: settings.copy.text25, sub: settings.copy.text26, icon: '🚀', col: '#8b5cf6', start: 8.6 }
    ];

    pills.forEach((p, idx) => {
      if (t >= p.start) {
        const pr = out(clamp((t - p.start) / 0.5));
        const y = 690 + idx * 88;
        g.save();
        g.translate(270, y);
        g.scale(pr, pr);
        g.globalAlpha = pr;
        shadow(() => {
          rr(-210, -36, 420, 72, 22, '#0f172a', '#334155', 1.5);
        }, 18, 'rgba(0,0,0,0.25)', 0, 8);

        circle(-168, 0, 24, p.col);
        txt(p.icon, -168, 0, 22, '#fff', 'center');

        txt(p.title, -130, -10, 18, '#ffffff', 'left', 700);
        txt(p.sub, -130, 14, 13, '#94a3b8', 'left', 500);
        g.restore();
      }
    });
  }
  g.restore();
}




function drawQ4(t) {
  g.save();
  rr(564, 564, 492, 492, 32, '#FFFFFF', '#f0f3f8', 2);
  g.beginPath();
  g.roundRect(564, 564, 492, 492, 32);
  g.clip();

  txt(settings.copy.text27, 810, 600, 16, '#94a3b8', 'center', 700);

  if (t < 7.2) {

    const playerP = out(clamp(t / 0.8));
    g.save();
    g.translate(810, 800);
    g.scale(playerP, playerP);

    glow(0, 0, 180, 'rgba(0,180,255,0.22)');

    shadow(() => {
      rr(-190, -170, 380, 340, 32, '#0f172a', '#1e293b', 2);
    }, 28, 'rgba(0,0,0,0.3)', 0, 14);

    drawGenericMark(-145, -130, 26, '#00D4FF');
    txt(settings.copy.text28, -115, -130, 17, '#f8fafc', 'left', 800);

    for (let i = 0; i < 5; i++) {
      let h = 12 + Math.sin(t * 12 + i * 1.5) * 10;
      rr(120 + i * 9, -130 - h * 0.5, 5, h, 2, '#00D4FF');
    }

    txt(settings.copy.text29, -145, -70, 19, '#ffffff', 'left', 700);
    txt(settings.copy.text30, -145, -42, 15, '#94a3b8', 'left', 500);

    const prog = clamp(t / 6.5);
    rr(-145, 0, 290, 8, 4, '#334155');
    rr(-145, 0, 290 * prog, 8, 4, '#00D4FF');
    circle(-145 + 290 * prog, 4, 8, '#ffffff');

    const curSec = Math.floor(prog * 120);
    const minStr = String(Math.floor(curSec / 60)).padStart(2, '0');
    const secStr = String(curSec % 60).padStart(2, '0');
    txt(minStr + ':' + secStr, -145, 26, 13, '#94a3b8', 'left', 600);
    txt('02:00 (Concluído)', 145, 26, 13, '#94a3b8', 'right', 600);

    rr(-45, 60, 90, 34, 17, '#1e293b', '#00D4FF', 1.5);
    txt('⚡ 2.0x', 0, 77, 14, '#00D4FF', 'center', 700);

    txt('⏮', -100, 120, 26, '#94a3b8', 'center');
    circle(0, 120, 24, '#0055ff');
    txt('❚❚', 0, 120, 18, '#ffffff', 'center');
    txt('⏭', 100, 120, 26, '#94a3b8', 'center');
    g.restore();
  }
  else {

    const kP = out(clamp((t - 7.2) / 0.5));
    g.save();
    g.translate(810, 770);
    g.scale(kP, kP);
    txt(settings.copy.text31, 0, -50, 24, '#64748b', 'center', 800);
    txt(settings.copy.text32, 0, -10, 36, '#0f172a', 'center', 900);
    txt(settings.copy.text33, 0, 36, 46, '#0048C0', 'center', 900);
    txt(settings.copy.text34, 0, 80, 26, '#0f172a', 'center', 800);
    g.restore();

    const dotPulse = 0.8 + 0.2 * Math.sin(t * 8);
    glow(810, 930, 40 * dotPulse, 'rgba(0,180,255,0.4)');
    circle(810, 930, 8 * dotPulse, '#00D4FF');
  }
  g.restore();
}




function drawFinale(t) {
  const transT = t - 10.8;
  const pTrans = out(clamp(transT / 0.8)); // 0 to 1 transition

  g.save();
  g.globalAlpha = pTrans;

  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, 1080, 1080);

  glow(540, 450, 480, 'rgba(0,85,255,0.08)');
  glow(540, 450, 240, 'rgba(0,212,255,0.12)');

  const scale = 0.85 + 0.15 * pTrans;
  g.save();
  g.translate(540, 420);
  g.scale(scale, scale);

  if (logoImg && logoImg.naturalWidth > 0) {
    const logoW = 680;
    const logoH = (logoW * logoImg.naturalHeight) / logoImg.naturalWidth;
    shadow(() => {
      g.drawImage(logoImg, -logoW * 0.5, -logoH * 0.5 - 20, logoW, logoH);
    }, 28, 'rgba(0,40,120,0.15)', 0, 14);
  } else {

    drawGenericMark(0, -70, 140, '#0048C0');
    txt(settings.copy.text35, 0, 30, 36, '#0033A0', 'center', 400);
    txt(settings.copy.text36, 0, 85, 78, '#002B80', 'center', 900);
  }
  g.restore();

  if (t >= 11.8) {
    const sloganP = out(clamp((t - 11.8) / 0.6));
    g.save();
    g.globalAlpha = sloganP;
    g.translate(540, 680 + (1 - sloganP) * 25);

    rr(-140 * sloganP, -40, 280 * sloganP, 4, 2, '#0048C0');

    txt(settings.copy.text37, 0, 0, 38, '#002B80', 'center', 900);
    g.restore();
  }

  if (t >= 12.6) {
    const ctaP = spring(clamp((t - 12.6) / 0.5));
    g.save();
    g.translate(540, 780);
    g.scale(ctaP, ctaP);

    shadow(() => {
      rr(-220, -32, 440, 64, 32, '#0048C0');
    }, 22, 'rgba(0,72,192,0.35)', 0, 10);
    txt(settings.copy.text38, 0, 0, 22, '#FFFFFF', 'center', 800);

    txt(settings.copy.text39, 0, 62, 18, '#64748b', 'center', 600);
    g.restore();
  }

  g.restore();
}



function draw(t) {

  g.setTransform(W / 1080, 0, 0, H / 1080, 0, 0);
  g.fillStyle = '#f8fafc';
  g.fillRect(0, 0, 1080, 1080);

  if (t < 11.6) {
    drawQ1(t);
    drawQ2(t);
    drawQ3(t);
    drawQ4(t);

    line(540, 0, 540, 1080, '#e2e8f0', 2);
    line(0, 540, 1080, 540, '#e2e8f0', 2);
    circle(540, 540, 18, '#FFFFFF', '#cbd5e1', 2);
    circle(540, 540, 6, '#0055ff');
  }

  if (t >= 10.8) {
    drawFinale(t);
  }
}

const imageReady=logoImg?logoImg.decode():Promise.resolve();
window.__setFrame = async (frame) => {await imageReady;draw(frame / ${scene.fps});};
})();</script></body></html>`;
}
