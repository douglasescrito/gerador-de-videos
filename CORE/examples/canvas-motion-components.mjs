import { createCanvasMotionPrimitives } from '../lib/media-pipeline/canvas-motion-primitives.mjs';

// Returns an offline document for the existing Studio document renderer.
// Does not create a renderer, server, timer, provider call or output file.
export function canvasMotionComponentsDocument({ width = 640, height = 360, accent = '#7be7d0', background = '#101827' } = {}) {
  for (const value of [width, height]) if (!Number.isInteger(value) || value < 64 || value > 4096) throw new Error('Dimensions must be integers from 64 to 4096.');
  for (const value of [accent, background]) if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Colors must use #RRGGBB.');
  const settings = JSON.stringify({ width, height, accent, background });
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:${background}}canvas{display:block}</style></head><body><canvas width="${width}" height="${height}"></canvas><script>
(()=>{const settings=${settings};
const context=document.querySelector('canvas').getContext('2d');
const motion=(${createCanvasMotionPrimitives.toString()})(context);
window.__setFrame=(frame,total)=>{
 const progress=motion.clamp(frame/Math.max(1,total-1));
 context.setTransform(settings.width/640,0,0,settings.height/360,0,0);
 context.fillStyle=settings.background;context.fillRect(0,0,640,360);
 const converge=motion.smooth((progress-.72)/.28);
 for(let index=0;index<4;index++){
  const enter=motion.out((progress-index*.06)/.24);
  const x=(170+(index%2)*300)*(1-converge)+320*converge;
  const y=(100+Math.floor(index/2)*160)*(1-converge)+180*converge;
  context.save();context.translate(x,y);context.scale(enter*(1-.4*converge),enter*(1-.4*converge));
  motion.glow(0,0,95,{color:settings.accent+'22',edge:settings.accent+'00'});
  motion.shadow(()=>motion.card(-120,-60,240,120,{fill:'#17263d',stroke:settings.accent,strokeWidth:1.5}));
  const pulse=motion.spring(motion.clamp(progress*2-index*.12));
  motion.circle(-72,0,12+8*pulse,{fill:settings.accent});
  motion.line(-35,-12,80,-12,{color:settings.accent,width:4});
  motion.line(-35,12,20+60*motion.smooth(progress),12,{color:settings.accent+'66',width:3});
  context.restore();
 }
};})();
</script></body></html>`;
}
