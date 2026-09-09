import studio from '@theatre/studio';

// Optional local authoring UI. Never import this module into a rendered master.
// State is explicitly exported by the author, not persisted to a parallel store.
export function initializeTheatreEditor() {
  studio.initialize({ usePersistentStorage: false });
  return { exportState(projectId) { return studio.createContentOfSaveFile(projectId); }, hide() { studio.ui.hide(); } };
}
