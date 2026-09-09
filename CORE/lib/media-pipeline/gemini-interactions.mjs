export function outputAudioFromInteraction(payload) {
  const direct = payload?.output_audio ?? payload?.outputAudio;
  if (direct?.data) return { data: direct.data, mimeType: direct.mime_type ?? direct.mimeType ?? null };
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (const step of [...steps].reverse()) {
    for (const content of [...(step?.content ?? [])].reverse()) {
      if (content?.type === "audio" && content.data) return { data: content.data, mimeType: content.mime_type ?? content.mimeType ?? null };
      if (content?.inline_data?.data) return { data: content.inline_data.data, mimeType: content.inline_data.mime_type ?? null };
    }
  }
  return null;
}
