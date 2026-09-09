import { bundleThreeDocument } from '../lib/media-pipeline/three-design.mjs';

// Receive embedded images only after the calling Studio plan has checked rights
// and bytes. This example does not acquire or persist private assets.
export async function createGalleryDocument(images) {
  if (!Array.isArray(images) || !images.length || images.length > 40) throw Error('Expected 1–40 authorized images.');
  const embedded = JSON.stringify(images.map(({ data }) => ({ data }))).replaceAll('<', '\\u003c');
  return bundleThreeDocument(`
import {createDesignScene} from './presets.mjs';
import {createImageGallery} from './gallery.mjs';
const spec={width:studio.width,height:studio.height,preset:'gallery',background:'#070d20',accent:'#91bdff',bloom:.25};
const design=createDesignScene(spec);
design.objects.forEach(object=>{object.visible=false});
const ready=createImageGallery(design.scene,${embedded},{width:7,holdSeconds:5,flightSeconds:1});
window.__setFrame=async(frame,total,context)=>{
 globalThis.__threeFrameTimeMs=context.timeSeconds*1000;
 const gallery=await ready;
 gallery.seek(context.timeSeconds,design.camera);
 design.render();
};`);
}
