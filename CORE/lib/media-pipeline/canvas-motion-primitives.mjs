// Pure Canvas helpers extracted from existing Studio motion compositions.
// No media, brand, filesystem, clock or animation loop. The renderer owns time.
export function createCanvasMotionPrimitives(context) {
  if (!context || typeof context.save !== 'function') throw new Error('Canvas 2D context required.');
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const out = value => 1 - (1 - clamp(value)) ** 4;
  const spring = value => { const t = clamp(value); return 1 - Math.cos(t * Math.PI * 3.5) * Math.exp(-t * 5); };
  const bounce = value => {
    let t = clamp(value); const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  };
  const paint = (fill, stroke, width) => {
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = width; context.stroke(); }
  };
  const card = (x, y, width, height, { radius = 20, fill = '#fff', stroke = null, strokeWidth = 2 } = {}) => {
    context.beginPath(); context.roundRect(x, y, width, height, radius); paint(fill, stroke, strokeWidth);
  };
  const circle = (x, y, radius, { fill = '#fff', stroke = null, strokeWidth = 2 } = {}) => {
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); paint(fill, stroke, strokeWidth);
  };
  const line = (x, y, endX, endY, { color = '#ddd', width = 2 } = {}) => {
    context.strokeStyle = color; context.lineWidth = width; context.beginPath();
    context.moveTo(x, y); context.lineTo(endX, endY); context.stroke();
  };
  const text = (value, x, y, { size = 30, color = '#111', align = 'center', weight = 700, family = 'Arial, sans-serif' } = {}) => {
    context.fillStyle = color; context.font = `${weight} ${size}px ${family}`;
    context.textAlign = align; context.textBaseline = 'middle'; context.fillText(String(value), x, y);
  };
  const shadow = (draw, { blur = 24, color = 'rgba(0,0,0,0.18)', x = 0, y = 10 } = {}) => {
    context.save();
    try { context.shadowColor = color; context.shadowBlur = blur; context.shadowOffsetX = x; context.shadowOffsetY = y; draw(); }
    finally { context.restore(); }
  };
  const glow = (x, y, radius, { color = 'rgba(100,200,255,0.25)', edge = 'rgba(100,200,255,0)' } = {}) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color); gradient.addColorStop(1, edge);
    context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  return { clamp, smooth, out, spring, bounce, card, circle, line, text, shadow, glow };
}
