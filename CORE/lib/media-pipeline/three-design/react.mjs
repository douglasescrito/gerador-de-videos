import * as THREE from 'three';
import { createRoot, extend } from '@react-three/fiber';
export { Float, RoundedBox, MeshTransmissionMaterial, ContactShadows, Environment, Lightformer } from '@react-three/drei';
export { createElement } from 'react';

// Components must derive animation from the supplied time; Float/useFrame delta
// accumulation is unsuitable for random seeks. Use only embedded assets.
export async function createReactScene({ canvas, width, height, element }) {
  extend(THREE);
  const root = createRoot(canvas);
  await root.configure({ frameloop: 'never', size: { width, height, top: 0, left: 0 }, dpr: 1, events: undefined,
    gl: { antialias: true, preserveDrawingBuffer: true }, camera: { position: [0, 0, 8], fov: 45 } });
  const store = root.render(element);
  // Wait for the concurrent React commit, not for an arbitrary timer.
  await new Promise(resolve => { if (store.getState().internal.active) return resolve(); const off = store.subscribe(s => { if (s.internal.active) { off(); resolve(); } }); });
  return { seek(seconds) { store.getState().advance(seconds, true); }, dispose() { root.unmount(); } };
}
