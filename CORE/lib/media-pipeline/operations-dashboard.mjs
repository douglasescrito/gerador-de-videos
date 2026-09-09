export const OPERATIONS_DASHBOARD_SCHEMA = "mkt-videos/operations-dashboard@1";

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = selector(value);
    if (key == null || key === "") continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function percent(value, total) {
  return total === 0 ? 0 : Number(((value / total) * 100).toFixed(1));
}

export function buildOperationsDashboard({
  health = null,
  batchJobs = [],
  attempts = {},
  promptIndex = { entries: {}, stats: {} },
  catalog = { videos: [], stats: {} },
  reviews = [],
  transcripts = [],
  templates = [],
  missions = [],
  runtime = null,
  generatedAt = new Date(),
}) {
  const attemptRows = Object.values(attempts ?? {});
  const promptRows = Object.values(promptIndex?.entries ?? {});
  const latencies = promptRows.map((entry) => Number(entry.durationMs)).filter(Number.isFinite);
  const videos = catalog?.videos ?? [];
  const transcriptAssets = new Set(transcripts.map((entry) => (entry.payload ?? entry).assetId));
  const batchAttention = batchJobs.filter((job) => job.state === "attention_required");
  const activeBatches = batchJobs.filter((job) => job.state === "running" || job.state === "pending");
  return {
    schema: OPERATIONS_DASHBOARD_SCHEMA,
    generatedAt: (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString(),
    health: health == null ? null : {
      uiReady: health.uiReady ?? null,
      transportReachable: health.transportReachable ?? null,
      sessionReady: health.sessionReady ?? null,
      generationCapability: health.generationCapability ?? null,
      archiveReady: health.archiveReady ?? null,
    },
    queue: {
      total: batchJobs.length,
      active: activeBatches.length,
      attentionRequired: batchAttention.length,
      states: countBy(batchJobs, (job) => job.state),
      itemOutcomes: batchJobs.reduce((totals, job) => {
        for (const [state, count] of Object.entries(job.counts ?? {})) {
          totals[state] = (totals[state] ?? 0) + Number(count);
        }
        return totals;
      }, {}),
    },
    attempts: {
      total: attemptRows.length,
      states: countBy(attemptRows, (entry) => entry.state),
      accepted: attemptRows.filter((entry) => entry.fileId).length,
      archived: attemptRows.filter((entry) => entry.archivedRelPath).length,
      attentionRequired: attemptRows.filter((entry) => entry.state === "attention_required").length,
    },
    latencyMs: {
      samples: latencies.length,
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
    },
    coverage: {
      videos: videos.length,
      prompt: {
        count: Number(promptIndex?.stats?.indexed ?? promptRows.length),
        percent: percent(Number(promptIndex?.stats?.indexed ?? promptRows.length), videos.length),
      },
      receipt: {
        count: Number(promptIndex?.stats?.withReceipt ?? 0),
        percent: percent(Number(promptIndex?.stats?.withReceipt ?? 0), videos.length),
      },
      measurement: {
        count: videos.filter((video) => video.duration != null).length,
        percent: percent(videos.filter((video) => video.duration != null).length, videos.length),
      },
      transcript: {
        count: videos.filter((video) => transcriptAssets.has(video.id) || transcriptAssets.has(video.relPath)).length,
        percent: percent(videos.filter((video) => transcriptAssets.has(video.id) || transcriptAssets.has(video.relPath)).length, videos.length),
      },
      review: {
        count: reviews.length,
        percent: percent(reviews.length, videos.length),
      },
    },
    dimensions: {
      templateRevision: countBy(promptRows, (entry) =>
        entry.templateBinding
          ? `${entry.templateBinding.templateId}@${entry.templateBinding.templateRevision}`
          : null),
      preset: countBy(promptRows, (entry) => entry.promptComposition?.directionPreset),
      task: countBy(promptRows, (entry) => entry.task),
      capability: countBy(promptRows, (entry) => entry.model),
    },
    templates: {
      logical: templates.length,
      active: templates.filter((entry) => entry.activeRevision != null).length,
      revisions: templates.reduce((sum, entry) => sum + (entry.revisions?.length ?? 0), 0),
    },
    storage: {
      videoSizeMb: Number(videos.reduce((sum, video) => sum + Number(video.sizeMb ?? 0), 0).toFixed(1)),
    },
    missions,
    runtime,
    contentCapture: false,
  };
}
