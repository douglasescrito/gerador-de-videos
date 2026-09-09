export function setPresenterReference(scene, file) {
  if (file && !/^[^/\\:\x00-\x1f]+\.(png|jpe?g|webp)$/i.test(file)) throw Error('Selecione uma imagem local válida da biblioteca de pessoas.');
  const references = (scene.references || []).filter(ref => ref.source !== 'pessoas');
  if (file) references.push({ source: 'pessoas', relPath: file, role: 'reference-image' });
  scene.references = references;
  scene.generationTask = references.length ? 'reference_to_video' : 'text_to_video';
}
