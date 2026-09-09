// Pure coordinate conversion for previewing existing clips in the browser.
// No rendering, compilation or new timeline persistence is performed here.
export function previewClipAt(clips, time) {
  return clips.find(c => c.assetId && !c.missing && time >= c.start && time < c.end) || null;
}
export function previewSourceTime(clip, time) {
  return (clip.sourceIn || 0) + Math.max(0, Math.min(time, clip.end) - clip.start);
}
export function previewSequenceTime(clip, time) {
  return Math.min(clip.end, Math.max(clip.start, clip.start + time - (clip.sourceIn || 0)));
}
