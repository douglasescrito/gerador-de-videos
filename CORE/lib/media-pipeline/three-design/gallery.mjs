import * as THREE from 'three';

// The caller supplies already-authorized embedded assets from the Studio plan.
// This helper neither reads files nor loads remote URLs.
export async function createImageGallery(scene, images, { width = 7, holdSeconds = 5, flightSeconds = 1 } = {}) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 40 || !(holdSeconds > flightSeconds && flightSeconds > 0)) throw Error('Galeria exige 1–40 imagens e hold maior que o voo.');
  const panels = await Promise.all(images.map(async asset => {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(asset.data ?? '')) throw Error('Imagem deve ser PNG/JPEG incorporada e autorizada pelo caller Studio.');
    const image = new Image(); image.src = asset.data; await image.decode();
    const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(width, width * image.naturalHeight / image.naturalWidth);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    return new THREE.Mesh(geometry, material);
  }));
  panels.forEach(panel => scene.add(panel));
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * x * (10 + x * (-15 + x * 6)); };
  return { panels, seek(t, camera) {
    panels.forEach((panel, i) => {
      const a = i * Math.PI * 2 / panels.length + t * .04;
      const enter = smooth((t - i * holdSeconds) / flightSeconds);
      const leave = i === panels.length - 1 ? 0 : smooth((t - (i + 1) * holdSeconds) / flightSeconds);
      const focus = enter * (1 - leave);
      panel.position.set(Math.cos(a) * 9, Math.sin(a) * 4, -5 + Math.sin(a) * 2);
      panel.position.lerp(new THREE.Vector3(0, 0, 3), focus);
      panel.scale.setScalar(.35 + focus * .65);
      panel.quaternion.copy(camera.quaternion);
    });
  }, dispose() { panels.forEach(p => { scene.remove(p); p.material.map.dispose(); p.material.dispose(); p.geometry.dispose(); }); } };
}
