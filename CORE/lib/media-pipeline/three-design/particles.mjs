import { MeshBasicMaterial, AdditiveBlending } from 'three';
import { BatchedRenderer, ParticleSystem, ConstantValue, SphereEmitter } from 'three.quarks';

export function createParticles(scene, { seed = 73 } = {}) {
  let rng = seed, step = 0;
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  globalThis.__threeRandom = random;
  const batch = new BatchedRenderer(); scene.add(batch);
  const material = new MeshBasicMaterial({ color: '#accfff', transparent: true, opacity: .25, blending: AdditiveBlending, depthWrite: false });
  const system = new ParticleSystem({ duration: 120, looping: false, shape: new SphereEmitter({ radius: 4 }),
    startLife: new ConstantValue(4), startSpeed: new ConstantValue(.2), startSize: new ConstantValue(.025), emissionOverTime: new ConstantValue(12), material });
  scene.add(system.emitter); batch.addSystem(system);
  return { seek(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw Error('Partículas exigem tempo de 0 a 120 s.');
    const target = Math.round(seconds * 60);
    if (target < step) { system.restart(); rng = seed; step = 0; }
    globalThis.__threeRandom = random;
    while (step < target) { batch.update(1 / 60); step++; }
  }, dispose() { batch.deleteSystem(system); system.dispose(); material.dispose(); scene.remove(batch); scene.remove(system.emitter); } };
}
