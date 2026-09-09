import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const fontRoot = path.join(root, 'assets/fonts/hyperframes-tipografia');
const manifestFile = path.join(fontRoot, 'manifest.json');
const runtimeFiles = ['gsap.min.js', 'CustomEase.min.js'].map(name => path.join(root, 'node_modules/gsap/dist', name));
export const PLAY_STYLE = 'typographic-play@1';
export const PLAY_FONT = 'HyperframesTypography';
export const PLAY_RECIPES = Object.freeze({
  'cabe-mais': { title: 'Cabe mais', sourceRecipe: '01-eixo-vivo', palette: ['#E5F15A', '#173C35', '#EF6746'], fonts: ['robotoflex', 'spacegrotesk'], copy: ['cabe', 'mais', 'ideia'], mechanism: 'Eixos reais wdth e wght; o espaço aberto pela letra recebe a próxima palavra.' },
  'vira-o-jogo': { title: 'Vira o jogo', sourceRecipe: '07-rolo-tipografico', palette: ['#5C3AE8', '#F7EFDF', '#BDFE72'], fonts: ['archivo', 'spacegrotesk'], copy: ['vira', 'a chave', 'o jogo', 'vídeo'], mechanism: 'Uma janela e um rolo persistentes; a alavanca muda o registro da palavra.' },
  'sai-da-orbita': { title: 'Sai da órbita', sourceRecipe: '04-orbita-de-sentido', palette: ['#181C36', '#EEE9DF', '#EE815D'], fonts: ['archivo', 'spacegrotesk'], copy: ['uma ideia', 'dá a volta', 'e encontra seu lugar'], mechanism: 'Glifos sobre caminho Bézier; a curva desemboca na linha de leitura.' },
  'dentro-do-o': { title: 'Dentro do O', sourceRecipe: '10-portal-da-letra', palette: ['#EADDEB', '#4726AC', '#FF7658'], fonts: ['archivo', 'spacegrotesk'], copy: ['OLHA', 'mais perto', 'outro mundo'], mechanism: 'O contraespaço do O permanece o mesmo portal durante a aproximação da câmera.' },
  'sem-freio': { title: 'Sem freio', sourceRecipe: '06-cartaz-em-tensao', palette: ['#F95532', '#191C1C', '#F4ECCF'], fonts: ['anton', 'spacegrotesk'], copy: ['BORA', 'TIRAR', 'DO PAPEL'], mechanism: 'Blocos rígidos em pressão; uma faixa atravessa a composição e a transforma em cartaz.' },
  'leve-e-ousado': { title: 'Leve e ousado', sourceRecipe: '12-duas-vozes-uma-ideia', palette: ['#F1EBDD', '#3B4535', '#BD5538'], fonts: ['fraunces', 'archivo', 'spacegrotesk'], copy: ['leve', 'ousado', 'os dois'], mechanism: 'Serifa itálica e sans pesada negociam a mesma linha e chegam juntas ao centro.' },
  'ideia-na-linha': { title: 'Ideia na linha', sourceRecipe: '03-fio-condutor', palette: ['#F0EBD9', '#254F44', '#E76643'], fonts: ['fraunces', 'spacegrotesk'], copy: ['vai', 'longe', 'uma ideia puxa outra'], mechanism: 'Uma linha desenhada por comprimento guia a câmera, escreve e vira sublinhado.' },
  'fora-de-registro': { title: 'Fora de registro', sourceRecipe: '18-impressao-em-registro', palette: ['#F0E8D8', '#203C39', '#ED604A'], fonts: ['anton', 'spacegrotesk'], copy: ['QUASE', 'AGORA', 'NO PONTO'], mechanism: 'Duas chapas de cor desencontradas entram em registro sem alterar os glifos.' },
  'acende': { title: 'Acende', sourceRecipe: '09-contraluz', palette: ['#181A23', '#EAE7DA', '#D9EE76'], fonts: ['archivo', 'spacegrotesk'], copy: ['tem ideia', 'acende', 'deixa aparecer'], mechanism: 'Uma faixa de luz revela texto por máscaras complementares e se abre no fechamento.' },
  'abre-espaco': { title: 'Abre espaço', sourceRecipe: '20-coreografia-do-espaco', palette: ['#DAE4F0', '#263E98', '#E98655'], fonts: ['archivo', 'spacegrotesk'], copy: ['menos', 'espaço', 'mais ideia'], mechanism: 'Dois planos se afastam; o vazio passa a ser o protagonista e abre espaço para a ideia.' },
});

export function validatePlayRecipe(value) {
  if (typeof value !== 'string' || !Object.hasOwn(PLAY_RECIPES, value)) throw new Error('playRecipe desconhecida.');
  return value;
}

// Only repository-owned, pinned font assets can enter this template. The
// arbitrary-document sandbox keeps its original Arial-only policy.
export async function typographicPlayAssets(recipe) {
  const definition = PLAY_RECIPES[validatePlayRecipe(recipe)];
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const entries = manifest.files.filter(file => definition.fonts.includes(file.family));
  const files = [];
  for (const entry of entries) {
    const file = path.resolve(root, entry.path);
    const actual = await realpath(file);
    if (!actual.toLowerCase().startsWith((fontRoot + path.sep).toLowerCase())) throw new Error('Fonte fora do pacote declarado.');
    const bytes = await readFile(actual);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256 || bytes.length !== entry.bytes) throw new Error('Fonte ou licença tipográfica diverge do manifesto.');
    files.push({ ...entry, file: actual });
  }
  for (const family of definition.fonts) {
    if (!files.some(file => file.family === family && file.path.endsWith('.ttf')) || !files.some(file => file.family === family && file.path.endsWith('/OFL.txt'))) throw new Error('Família exige fonte e licença OFL declaradas.');
  }
  return { files: [manifestFile, ...runtimeFiles, ...files.map(file => file.file)], fonts: files.filter(file => file.path.endsWith('.ttf')), definition };
}

// This is composition code, consumed by the existing HyperFrames adapter.
// GSAP owns all keyframes; capture, encoding, recovery and publication remain
// in the Studio executor. There is no wall-clock animation or secondary loop.
function composePlay(scene, definition) {
  const svg = document.querySelector('svg');
  const ns = 'http://www.w3.org/2000/svg';
  const [bg, ink, accent] = definition.palette;
  const add = (tag, attrs = {}, content = '', parent = svg) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (content) node.textContent = content;
    parent.appendChild(node); return node;
  };
  const attr = (node, values) => { for (const [key, value] of Object.entries(values)) node.setAttribute(key, value); };
  const group = parent => add('g', {}, '', parent);
  const rect = (x, y, width, height, fill, parent = svg, extra = {}) => add('rect', { x, y, width, height, fill, ...extra }, '', parent);
  const circle = (x, y, r, fill, parent = svg, extra = {}) => add('circle', { cx: x, cy: y, r, fill, ...extra }, '', parent);
  const line = (d, stroke, width = 3, parent = svg, extra = {}) => add('path', { d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra }, '', parent);
  const type = (copy, x, y, size, family = 'PlaySans', weight = 600, fill = ink, parent = svg, extra = {}) => add('text', { x, y, fill, 'font-family': family, 'font-size': size, 'font-weight': weight, 'text-anchor': 'middle', 'dominant-baseline': 'central', ...extra }, copy, parent);
  const fit = (node, max) => { const width = node.getComputedTextLength(); if (width > max) node.setAttribute('font-size', Number(node.getAttribute('font-size')) * max / width); return node; };
  const move = (node, x = 0, y = 0, scale = 1, angle = 0) => attr(node, { transform: `translate(${x} ${y}) rotate(${angle}) scale(${scale})` });
  const opacity = (node, value) => attr(node, { opacity: Math.min(1, Math.max(0, value)) });
  const clip = (id, x, y, w, h, r = 0) => {
    const cp = add('clipPath', { id }, '', defs);
    return rect(x, y, w, h, '#fff', cp, { rx: r });
  };
  const defs = add('defs');
  rect(0, 0, 1920, 1080, bg);
  const tl = gsap.timeline({ paused: true });
  gsap.registerPlugin(CustomEase);
  const curves = { arrive: '0.16,1,0.3,1', travel: '0.76,0,0.24,1', snap: '0.85,0,0.15,1', float: '0.42,0,0.58,1' };
  for (const [id, data] of Object.entries(curves)) CustomEase.create(id, data);
  const tracks = [];
  let trackId = 0;
  const state = initial => ({ ...initial, _trackId: ++trackId });
  const key = (target, prop, from, to, at, duration, ease = 'travel') => {
    tracks.push({ target: target._trackId, property: prop, from, to, at, duration, curve: curves[ease] ?? ease });
    tl.fromTo(target, { [prop]: from }, { [prop]: to, duration, ease, immediateRender: false, lazy: false }, at);
  };
  const reveal = (p, prop, at, duration = .8) => key(p, prop, 0, 1, at, duration, 'arrive');

  function cabeMais() {
    const word = type('cabe', 960, 435, 340, 'PlayFlex', 780);
    const slot = rect(775, 640, 370, 145, ink, svg, { rx: 73 });
    const small = type('mais', 960, 707, 104, 'PlayFlex', 650, bg);
    const idea = type('mais ideia', 960, 706, 240, 'PlayFlex', 820);
    const left = line('M 190 293 L 150 293 L 150 592 L 190 592', ink, 4);
    const right = line('M 1730 293 L 1770 293 L 1770 592 L 1730 592', ink, 4);
    const dot = circle(1660, 726, 22, accent);
    const p = state({ wdth: 45, wght: 450, open: 0, y: 0, slot: 0, swap: 0, dot: 0, bracket: 0 });
    key(p, 'wdth', 45, 142, .4, 2.0, 'arrive'); key(p, 'wght', 450, 820, .4, 2.0, 'arrive');
    reveal(p, 'slot', 1.4); key(p, 'wdth', 142, 64, 3.2, 1.3); key(p, 'wght', 820, 620, 3.2, 1.3);
    key(p, 'wdth', 64, 134, 5.4, 1.4); key(p, 'wght', 620, 920, 5.4, 1.4);
    key(p, 'y', 0, -78, 8.0, 1.5); key(p, 'swap', 0, 1, 8.0, 1.5); key(p, 'wdth', 134, 105, 8.0, 1.5);
    reveal(p, 'dot', 10.4, 1); reveal(p, 'bracket', .3, .8); key(p, 'open', 0, 1, 8, 1.5);
    return () => {
      word.style.fontVariationSettings = `'wdth' ${p.wdth}, 'wght' ${p.wght}, 'opsz' 144`;
      move(word, 0, p.y); move(left, -p.open * 26); move(right, p.open * 26);
      opacity(left, p.bracket * (1 - p.open)); opacity(right, p.bracket * (1 - p.open));
      opacity(slot, p.slot * (1 - p.swap)); opacity(small, p.slot * (1 - p.swap));
      move(slot, 0, p.swap * 85); move(small, 0, p.swap * 85);
      opacity(idea, p.swap); move(idea, 0, (1 - p.swap) * 110);
      idea.style.fontVariationSettings = `'wdth' ${72 + p.swap * 38}, 'wght' 820, 'opsz' 144`;
      opacity(dot, p.dot); move(dot, (1 - p.dot) * 80, 0, 1);
    };
  }

  function viraJogo() {
    const panel = group();
    rect(-690, -200, 1380, 400, ink, panel, { rx: 200 });
    clip('roller', -626, -166, 1252, 332, 130);
    const inside = add('g', { 'clip-path': 'url(#roller)' }, '', panel);
    const roll = group(inside);
    ['a chave', 'o jogo', 'a ideia', 'vídeo'].forEach((copy, i) => fit(type(copy, 0, i * 360, 224, 'PlayArchivo', 760, bg, roll), 1140));
    const prefix = type('vira', 960, 216, 112, 'PlaySans', 500);
    const lever = group();
    line('M 0 0 L 0 -160', accent, 12, lever); circle(0, -170, 38, accent, lever);
    circle(0, 0, 19, accent, lever);
    const caption = type('sua ideia em movimento.', 960, 871, 43, 'PlaySans', 500);
    const p = state({ roll: 0, turn: -28, panel: 0, shift: 0, end: 0 });
    key(p, 'panel', 0, 1, .2, 1.2, 'arrive');
    for (const [at, from, to] of [[2.6, 0, 360], [5.1, 360, 720], [8.1, 720, 1080]]) {
      key(p, 'roll', from, to, at, 1.0, 'snap');
      key(p, 'turn', -28, 35, at - .3, .45, 'arrive'); key(p, 'turn', 35, -28, at + .3, .8, 'arrive');
    }
    key(p, 'shift', 0, 1, 10.2, 1.3); reveal(p, 'end', 10.7, .9);
    return () => {
      move(panel, 960, 530 + (1 - p.panel) * 170, .9 + p.panel * .1, (1 - p.panel) * -5);
      move(roll, 0, -p.roll); move(lever, 1710 + p.shift * 350, 530, 1, p.turn);
      opacity(panel, p.panel); opacity(prefix, 1 - p.shift); move(prefix, 0, p.shift * -80);
      opacity(caption, p.end); move(caption, 0, (1 - p.end) * 30);
    };
  }

  function orbita() {
    const orbit = line('M 150 690 C 390 50 1530 50 1770 690', accent, 3);
    const path = add('path', { id: 'orbit-type', d: 'M 100 690 C 480 -20 1440 -20 1820 690' }, '', defs);
    const traveling = type('', 0, 0, 112, 'PlayArchivo', 600, ink);
    traveling.removeAttribute('x'); traveling.removeAttribute('y');
    const onPath = add('textPath', { href: '#orbit-type', startOffset: '50%' }, 'uma ideia', traveling);
    const orb = circle(960, 740, 45, accent);
    const middle = type('dá a volta', 960, 613, 158, 'PlayArchivo', 720);
    const end = type('e encontra seu lugar.', 960, 660, 70, 'PlaySans', 500);
    const p = state({ bend: 1, offset: 14, label: 0, travel: 0, resolve: 0, end: 0 });
    key(p, 'offset', 14, 50, .2, 2.0, 'arrive'); reveal(p, 'label', 2.4);
    key(p, 'offset', 50, 85, 4, 1.5); key(p, 'travel', 0, 1, 4, 3.7, 'float');
    key(p, 'offset', 85, 50, 6.4, 2.2); key(p, 'bend', 1, 0, 7.0, 2.5);
    key(p, 'resolve', 0, 1, 7, 2.5); reveal(p, 'end', 10.0, 1.3);
    return () => {
      const y = 430 + p.bend * 260, control = 430 - p.bend * 450;
      attr(path, { d: `M 100 ${y} C 480 ${control} 1440 ${control} 1820 ${y}` });
      attr(orbit, { d: `M 150 ${y + 115} C 480 ${control + 115} 1440 ${control + 115} 1770 ${y + 115}`, opacity: .55 + p.resolve * .45 });
      attr(traveling, { 'font-size': 112 + p.resolve * 88 });
      attr(onPath, { startOffset: `${p.offset}%` });
      opacity(middle, p.label * (1 - p.resolve)); move(middle, 0, -p.resolve * 45);
      const angle = p.travel * Math.PI * 2;
      attr(orb, { cx: 960 + Math.sin(angle) * 605 * (1 - p.resolve), cy: 744 - (1 - Math.cos(angle)) * 270 * (1 - p.resolve) - p.resolve * 199, r: 45 - p.resolve * 30 });
      opacity(end, p.end); move(end, 0, (1 - p.end) * 30);
    };
  }

  function portal() {
    // An elliptical counter is the actual opening of our custom O. No shape
    // matching or unrelated whole-word contour interpolation is involved.
    const world = group();
    const o = group(world);
    add('ellipse', { cx: 0, cy: 0, rx: 184, ry: 217, fill: ink }, '', o);
    add('ellipse', { cx: 0, cy: 0, rx: 78, ry: 124, fill: bg }, '', o);
    const rest = type('LHA', 250, 0, 440, 'PlayArchivo', 880, ink, world, { 'text-anchor': 'start' });
    const closer = type('mais perto.', 960, 843, 66, 'PlaySans', 500);
    const cp = add('clipPath', { id: 'counter' }, '', defs);
    const opening = add('ellipse', { cx: 350, cy: 520, rx: 0, ry: 0 }, '', cp);
    const inside = add('g', { 'clip-path': 'url(#counter)' });
    rect(0, 0, 1920, 1080, accent, inside);
    const rings = group(inside);
    for (let i = 0; i < 5; i++) add('ellipse', { cx: 960, cy: 540, rx: 280 + i * 172, ry: 175 + i * 108, stroke: ink, 'stroke-width': 2, fill: 'none' }, '', rings);
    const other = type('outro', 960, 404, 228, 'PlayArchivo', 780, ink, inside);
    const mundo = type('mundo', 960, 664, 260, 'PlayArchivo', 780, ink, inside);
    const p = state({ enter: 0, zoom: 1, cam: 0, show: 0, rings: 0 });
    reveal(p, 'enter', .2, 1.5); key(p, 'zoom', 1, 1.45, 3, 1.7); key(p, 'cam', 0, 1, 3, 1.7);
    key(p, 'zoom', 1.45, 19, 6.1, 3.0, 'travel'); reveal(p, 'show', 7.7, 2.0); key(p, 'rings', 0, 1, 9.5, 2.4, 'arrive');
    return () => {
      const ox = 350 + p.cam * 610, oy = 520;
      move(world, ox, oy, p.zoom); move(o, 0, (1 - p.enter) * 420);
      opacity(rest, p.enter); opacity(closer, p.enter * Math.max(0, 1 - (p.zoom - 1) / 2));
      attr(opening, { cx: ox, cy: oy, rx: 77 * p.zoom, ry: 123 * p.zoom });
      move(other, 0, (1 - p.show) * 130); move(mundo, 0, (1 - p.show) * 170);
      opacity(other, p.show); opacity(mundo, p.show); opacity(rings, 1 - p.rings * .72);
      move(rings, 960, 540, 1 + p.rings * .2); attr(rings, { transform: `translate(960 540) scale(${1 + p.rings * .2}) translate(-960 -540)` });
    };
  }

  function poster() {
    const paper = group();
    rect(-605, -465, 1210, 930, ink, paper);
    const top = type('BORA', 0, -225, 364, 'PlayAnton', 400, bg, paper);
    const middle = type('TIRAR', 0, 90, 334, 'PlayAnton', 400, bg, paper);
    const band = group();
    rect(-1100, -99, 2200, 198, accent, band);
    type('DO PAPEL', 0, 0, 155, 'PlayAnton', 400, ink, band);
    const mark = group();
    line('M -31 0 L 31 0 M 0 -31 L 0 31 M -22 -22 L 22 22 M 22 -22 L -22 22', ink, 8, mark);
    const p = state({ enter: 0, squeeze: 0, band: 0, turn: -11, end: 0 });
    reveal(p, 'enter', .1, 1.3); key(p, 'squeeze', 0, 1, 2.7, 1.2); key(p, 'squeeze', 1, 0, 5.2, 1.1);
    key(p, 'band', 0, 1, 5.2, 1.5, 'snap'); key(p, 'turn', -11, 7, 5.2, 1.5);
    key(p, 'turn', 7, -5, 8.6, 1.7); reveal(p, 'end', 9.8, 1.8);
    return () => {
      move(paper, 960, 540 + (1 - p.enter) * 850, .84 + p.end * .09, p.turn);
      move(top, -p.squeeze * 50, p.squeeze * 18); move(middle, p.squeeze * 65, -p.squeeze * 8);
      move(band, 960 + (1 - p.band) * 2300, 900 - p.end * 10, 1, -p.turn * .6);
      move(mark, 1620, 250, .1 + .9 * p.end, p.end * 135); opacity(mark, p.end);
    };
  }

  function duet() {
    const a = type('leve', 620, 425, 300, 'PlaySerifItalic', 520);
    const b = type('ousado', 1220, 688, 232, 'PlayArchivo', 880, accent);
    const thread = line('M 140 565 C 560 565 520 565 960 565 S 1380 565 1780 565', ink, 3);
    const amp = type('&', 890, 540, 125, 'PlaySerifItalic', 500);
    const ending = type('os dois.', 960, 845, 82, 'PlaySerifItalic', 600);
    const p = state({ a: 0, b: 0, sway: 0, join: 0, end: 0 });
    reveal(p, 'a', .15, 1.7); reveal(p, 'b', 2.1, 1.5); key(p, 'sway', 0, 1, 4.1, 1.8);
    key(p, 'sway', 1, -1, 6.1, 1.8); key(p, 'sway', -1, 0, 8.3, 1.8);
    reveal(p, 'join', 8.3, 2.0); reveal(p, 'end', 10.3, 1.3);
    return () => {
      attr(a, { transform: `translate(${620 - (1 - p.a) * 550 - p.join * 100} ${425 + (1 - p.a) * 130 - p.sway * 45 + p.join * 115}) rotate(${-p.sway * 3}) scale(${1 - p.join * .13}) translate(-620 -425)` });
      attr(b, { transform: `translate(${1220 + (1 - p.b) * 580 + p.join * 120} ${688 + (1 - p.b) * 100 + p.sway * 45 - p.join * 148}) rotate(${p.sway * 2}) scale(${1 - p.join * .11}) translate(-1220 -688)` });
      opacity(a, p.a); opacity(b, p.b); opacity(amp, p.join);
      attr(thread, { d: `M 140 565 C 460 ${565 - p.sway * 180} 550 ${565 - p.sway * 180} 960 565 S 1430 ${565 + p.sway * 180} 1780 565` });
      opacity(thread, 1 - p.join); opacity(ending, p.end); move(ending, 0, (1 - p.end) * 30);
    };
  }

  function fio() {
    const world = group();
    // Original monoline 'vai' and its outgoing connector form one writing
    // gesture; the line's moving tip uses the same measured SVG path length.
    const d = 'M -100 665 C 130 665 150 525 250 455 L 330 660 Q 345 690 365 645 L 455 437 M 656 536 C 601 449 486 492 489 593 C 492 701 644 697 653 564 L 650 665 M 756 510 L 756 661 C 843 739 1060 683 1225 561 C 1470 380 1830 426 2100 560 C 2290 667 2360 730 2650 730';
    const stroke = line(d, ink, 16, world);
    const length = stroke.getTotalLength();
    attr(stroke, { 'stroke-dasharray': length, 'stroke-dashoffset': length });
    const dotI = circle(756, 445, 9, ink, world);
    const tip = circle(0, 0, 15, accent, world);
    const longe = type('longe.', 2135, 350, 290, 'PlaySerifItalic', 650, ink, world);
    const end = type('uma ideia puxa outra.', 2135, 833, 53, 'PlaySans', 500, ink, world);
    const p = state({ draw: 0, camera: 0, dot: 0, word: 0, end: 0 });
    key(p, 'draw', 0, .58, .1, 3.2, 'arrive'); reveal(p, 'dot', 2.5, .4);
    key(p, 'draw', .58, 1, 4.1, 5.0, 'float'); key(p, 'camera', 0, 1175, 4.1, 5.0, 'float');
    reveal(p, 'word', 6.9, 1.7); reveal(p, 'end', 10, 1.4);
    return () => {
      attr(stroke, { 'stroke-dashoffset': length * (1 - p.draw) });
      const point = stroke.getPointAtLength(length * p.draw); attr(tip, { cx: point.x, cy: point.y });
      move(world, -p.camera, 0); opacity(dotI, p.dot); opacity(longe, p.word); move(longe, 0, (1 - p.word) * 90);
      opacity(end, p.end); opacity(tip, 1 - p.end * .5);
    };
  }

  function register() {
    const guide = group();
    for (const x of [245, 1675]) for (const y of [230, 770]) {
      line(`M ${x - 25} ${y} L ${x + 25} ${y} M ${x} ${y - 25} L ${x} ${y + 25}`, ink, 2, guide);
      circle(x, y, 15, 'none', guide, { stroke: ink, 'stroke-width': 1 });
    }
    const upper = type('QUASE', 960, 500, 328, 'PlayAnton', 400, '#EB554A');
    const lower = type('QUASE', 960, 500, 328, 'PlayAnton', 400, '#168F9C'); lower.style.mixBlendMode = 'multiply';
    const solid = type('AGORA', 960, 500, 328, 'PlayAnton', 400, ink);
    const capsule = rect(746, 769, 428, 93, ink, svg, { rx: 47 });
    const caption = type('NO PONTO.', 960, 814, 44, 'PlaySans', 650, bg);
    const p = state({ offset: 82, y: -35, angle: -3, change: 0, snap: 0, end: 0 });
    key(p, 'offset', 82, -32, .4, 2.0, 'arrive'); key(p, 'y', -35, 28, .4, 2.0);
    key(p, 'offset', -32, 45, 3.4, 1.4); key(p, 'y', 28, -15, 3.4, 1.4); key(p, 'angle', -3, 2, 3.4, 1.4);
    key(p, 'offset', 45, 0, 6, 2.0, 'snap'); key(p, 'y', -15, 0, 6, 2.0, 'snap'); key(p, 'angle', 2, 0, 6, 2.0);
    key(p, 'change', 0, 1, 8.7, .75, 'snap'); reveal(p, 'end', 10, 1.1);
    return () => {
      move(upper, p.offset, p.y); move(lower, -p.offset, -p.y);
      upper.textContent = p.change >= .5 ? 'AGORA' : 'QUASE'; lower.textContent = upper.textContent;
      opacity(upper, 1 - p.end); opacity(lower, 1 - p.end); opacity(solid, p.end);
      attr(guide, { transform: `rotate(${p.angle} 960 500)`, opacity: 1 - p.end * .8 });
      move(solid, 0, -p.end * 5); opacity(capsule, p.end); opacity(caption, p.end);
      move(capsule, 0, (1 - p.end) * 50); move(caption, 0, (1 - p.end) * 50);
    };
  }

  function light() {
    clip('light-words', 100, 260, 1720, 400);
    const dark = add('g', { 'clip-path': 'url(#light-words)' });
    const darkText = type('tem ideia?', 960, 475, 239, 'PlayArchivo', 760, '#40434A', dark);
    const cp = clip('light', 50, 0, 50, 1080);
    const lit = add('g', { 'clip-path': 'url(#light)' });
    rect(0, 0, 1920, 1080, accent, lit);
    const glyphs = add('g', { 'clip-path': 'url(#light-words)' }, '', lit);
    const litText = type('tem ideia?', 960, 475, 239, 'PlayArchivo', 760, bg, glyphs);
    const finalText = type('acende.', 960, 475, 300, 'PlayArchivo', 800, bg, glyphs);
    const lineText = type('deixa aparecer.', 960, 746, 78, 'PlaySans', 500, bg, lit);
    const switcher = group();
    rect(-94, -41, 188, 82, '#40434A', switcher, { rx: 41 });
    const knob = circle(-50, 0, 31, ink, switcher);
    const p = state({ x: -180, w: 180, change: 0, end: 0, knob: 0 });
    key(p, 'x', -180, 450, .2, 2.1, 'arrive'); key(p, 'x', 450, 1380, 3.0, 2.3, 'float');
    key(p, 'x', 1380, 650, 5.8, 1.9); key(p, 'w', 180, 620, 5.8, 1.9);
    key(p, 'change', 0, 1, 7.5, 1.1, 'snap'); key(p, 'x', 650, -40, 8.6, 2.4); key(p, 'w', 620, 2000, 8.6, 2.4);
    key(p, 'knob', 0, 1, 8.4, .9, 'arrive'); reveal(p, 'end', 10.2, 1.4);
    return () => {
      attr(cp, { x: p.x, width: p.w });
      move(litText, 0, -p.change * 460); move(darkText, 0, -p.change * 460); move(finalText, 0, (1 - p.change) * 460);
      opacity(lineText, p.end); move(lineText, 0, (1 - p.end) * 40);
      move(switcher, 960, 875); attr(knob, { cx: -50 + p.knob * 100, fill: p.knob > .5 ? accent : ink });
    };
  }

  function space() {
    const left = rect(0, 0, 830, 1080, ink);
    const right = rect(1090, 0, 830, 1080, ink);
    const negative = type('espaço', 960, 510, 270, 'PlayArchivo', 730, ink);
    const under = type('mais ideia.', 960, 730, 131, 'PlayArchivo', 660, ink);
    // Foreground slabs initially cover the letters they are making room for.
    svg.append(left, right);
    const less = type('menos', 960, 510, 280, 'PlayArchivo', 810, bg);
    const dot = circle(960, 510, 30, accent);
    const railA = line('M 210 800 L 700 800', bg, 4);
    const railB = line('M 1220 800 L 1710 800', bg, 4);
    const p = state({ gap: 0, less: 0, dot: 0, end: 0, widen: 0 });
    key(p, 'gap', 0, -125, .4, 1.4); key(p, 'gap', -125, 145, 3.0, 1.8);
    key(p, 'less', 0, 1, 3.0, 1.8); reveal(p, 'dot', 4.2, .8);
    key(p, 'gap', 145, 735, 5.7, 2.6); key(p, 'widen', 0, 1, 5.7, 2.6); reveal(p, 'end', 9.6, 1.5);
    return () => {
      move(left, -p.gap); move(right, p.gap); move(railA, -p.gap); move(railB, p.gap);
      opacity(less, 1 - p.less); move(less, 0, -p.less * 60);
      opacity(dot, p.dot); attr(dot, { cy: 510 + p.widen * 343, r: 30 - p.widen * 18 });
      opacity(negative, p.widen); opacity(under, p.end); move(under, 0, (1 - p.end) * 50);
    };
  }

  const builders = { 'cabe-mais': cabeMais, 'vira-o-jogo': viraJogo, 'sai-da-orbita': orbita, 'dentro-do-o': portal, 'sem-freio': poster, 'leve-e-ousado': duet, 'ideia-na-linha': fio, 'fora-de-registro': register, acende: light, 'abre-espaco': space };
  const draw = builders[scene.playRecipe]();
  // Series marks stay peripheral. Each composition itself supplies its ending.
  const index = Object.keys(builders).indexOf(scene.playRecipe) + 1;
  const topMark = type(`${String(index).padStart(2, '0')} / ${definition.title.toUpperCase()}`, 96, 75, 24, 'PlaySans', 500, ink, svg, { 'text-anchor': 'start' });
  const signature = type('GERADOR DE VÍDEOS', 96, 1010, 23, 'PlaySans', 600, ink, svg, { 'text-anchor': 'start', 'letter-spacing': 2 });
  const edition = type('ideias que se movem.', 1824, 1010, 24, 'PlaySans', 400, ink, svg, { 'text-anchor': 'end' });
  if (scene.playRecipe === 'abre-espaco') { topMark.setAttribute('fill', bg); signature.setAttribute('fill', bg); edition.setAttribute('fill', bg); }
  // Padding only, not an animation driver. The final pose is held for >=1.5s.
  tl.to({}, { duration: scene.durationSeconds }, 0);
  window.__timelines = { 'typographic-play': tl };
  window.__playDiagnostics = { tracks, curves, recipe: scene.playRecipe, sourceRecipe: definition.sourceRecipe, copy: definition.copy, mechanism: definition.mechanism, fontFamilies: definition.fonts, duration: scene.durationSeconds, finalHoldStart: 12.2 };
  window.__setFrame = frame => {
    const time = Math.max(0, Math.min(scene.durationSeconds, frame / scene.fps));
    window.__studioTimeMs = time * 1000;
    tl.seek(time, true); gsap.ticker.sleep(); draw();
    if (scene.playRecipe === 'abre-espaco') {
      const light = time > 8.3 ? ink : bg;
      topMark.setAttribute('fill', light); signature.setAttribute('fill', light); edition.setAttribute('fill', light);
    }
    if (scene.playRecipe === 'acende') {
      const color = time >= 11 ? bg : ink;
      topMark.setAttribute('fill', color); signature.setAttribute('fill', color); edition.setAttribute('fill', color);
    }
  };
  window.__setFrame(0); gsap.ticker.sleep();
}

function fontDescriptor(entry) {
  const italic = entry.path.includes('Italic');
  const family = { robotoflex: 'PlayFlex', fraunces: italic ? 'PlaySerifItalic' : 'PlaySerif', archivo: italic ? 'PlayArchivoItalic' : 'PlayArchivo', anton: 'PlayAnton', spacegrotesk: 'PlaySans' }[entry.family];
  return { family, weight: entry.family === 'anton' ? '400' : '100 1000' };
}

export async function typographicPlayDocument(scene, assets = null) {
  const resolved = assets ?? await typographicPlayAssets(scene.playRecipe);
  const scripts = await Promise.all(runtimeFiles.map(file => readFile(file, 'utf8')));
  const faces = await Promise.all(resolved.fonts.map(async entry => {
    const { family, weight } = fontDescriptor(entry);
    return `@font-face{font-family:${family};font-weight:${weight};src:url(data:font/ttf;base64,${(await readFile(entry.file)).toString('base64')})}`;
  }));
  const names = resolved.fonts.map(entry => fontDescriptor(entry).family);
  const safe = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  return `<style>${faces.join('')}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${scene.background}}svg{width:100%;height:100%;display:block;font-synthesis:none}text{font-kerning:normal}</style><div style="width:100%;height:100%" data-composition-id="typographic-play" data-duration="${scene.durationSeconds}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"></svg></div>${scripts.map(script => `<script>${script.replaceAll('</script', '<\\/script')}</script>`).join('')}<script>window.__playReady=(async()=>{await Promise.all(${safe(names)}.map(f=>document.fonts.load('400 100px '+f)));await document.fonts.ready;(${composePlay.toString()})(${safe(scene)},${safe(resolved.definition)});})();</script>`;
}
