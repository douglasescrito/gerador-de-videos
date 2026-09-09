import * as THREE from 'three';
import { gsap } from 'gsap';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

export function createDesignScene(spec) {
  gsap.ticker.sleep();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(spec.width, spec.height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(spec.background);
  const camera = new THREE.PerspectiveCamera(45, spec.width / spec.height, .1, 100);
  camera.position.set(0, 0, 15);
  scene.add(new THREE.HemisphereLight('#c8dfff', '#16131d', 2));
  const key = new THREE.DirectionalLight('#fff0dc', 5); key.position.set(-3, 5, 8); scene.add(key);
  const rim = new THREE.PointLight(spec.accent, 60); rim.position.set(5, 1, 3); scene.add(rim);
  const meshes = [], timelines = [];
  const count = spec.preset === 'prism' ? 3 : 9;
  for (let i = 0; i < count; i++) {
    const geometry = spec.preset === 'gallery' ? new THREE.BoxGeometry(3.7, 2.1, .12) : spec.preset === 'prism' ? new THREE.IcosahedronGeometry(1.6, 0) : new THREE.TorusGeometry(1.3, .08, 12, 64);
    const material = new THREE.MeshPhysicalMaterial({ color: i % 2 ? '#d0bcab' : spec.accent, metalness: .65, roughness: .19, clearcoat: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    if (spec.preset === 'gallery') {
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: spec.accent, toneMapped: false })); mesh.add(edge);
    }
    scene.add(mesh); meshes.push(mesh);
    const state = { angle: i * Math.PI * 2 / count };
    const tl = gsap.timeline({ paused: true }).to(state, { angle: state.angle + Math.PI * 2, duration: 120, ease: 'none' });
    timelines.push({ tl, state });
  }
  let composer = null;
  if (spec.bloom > 0) {
    composer = new EffectComposer(renderer, { multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: spec.bloom, luminanceThreshold: .8, mipmapBlur: true })));
  }
  gsap.ticker.sleep();
  return { scene, renderer, camera, objects: meshes,
    seek(t) {
      timelines.forEach(({ tl, state }, i) => {
        tl.totalTime(t, true); const a = state.angle, mesh = meshes[i];
        mesh.position.set(Math.cos(a) * (spec.preset === 'prism' ? 3.5 : 5), Math.sin(a) * 2.5, Math.sin(a * 2) * 2 - 2);
        mesh.rotation.set(Math.sin(t * .3 + i) * .2, t * .12 + i * .2, Math.sin(a) * .12);
        if (spec.preset === 'gallery') {
          const center = (t / 4) % meshes.length;
          const distance = Math.min(Math.abs(center - i), meshes.length - Math.abs(center - i));
          const focus = Math.max(0, 1 - distance * 2);
          mesh.position.lerp(new THREE.Vector3(0, 0, 6), focus);
          mesh.rotation.set(mesh.rotation.x * (1 - focus), mesh.rotation.y * (1 - focus), mesh.rotation.z * (1 - focus));
        }
      });
      gsap.ticker.sleep();
    },
    render() { composer ? composer.render(0) : renderer.render(scene, camera); },
    dispose() { timelines.forEach(x => x.tl.kill()); scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); composer?.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
