import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const JOB_TIMING_FIELDS = Object.freeze([
  "queueMs",
  "preparationMs",
  "requestMs",
  "providerProcessingMs",
  "providerMs",
  "downloadMs",
  "artifactCommitMs",
  "receiptMs",
  "localFinalizeMs",
  "videoDeliveryMs",
  "totalMs",
]);

function nonnegativeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? Number(value) : null;
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sortedDurations(values) {
  return values.map(nonnegativeNumber).filter((value) => value !== null).sort((a, b) => a - b);
}

export function percentileNearestRank(values, percentile) {
  const sorted = sortedDurations(values);
  if (!sorted.length) return null;
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) throw new Error("percentile deve estar entre 0 e 1.");
  if (percentile === 0) return sorted[0];
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1)];
}

export function summarizeMilliseconds(values) {
  const sorted = sortedDurations(values);
  if (!sorted.length) return { count: 0, min: null, max: null, mean: null, median: null, p95: null, total: 0 };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length,
    min: rounded(sorted[0]),
    max: rounded(sorted.at(-1)),
    mean: rounded(total / sorted.length),
    median: rounded(median),
    p95: rounded(percentileNearestRank(sorted, 0.95)),
    total: rounded(total),
  };
}

function durationEstimate(samples) {
  const sorted = sortedDurations(samples);
  if (!sorted.length) return null;
  return sorted.length <= 3
    ? summarizeMilliseconds(sorted).median
    : percentileNearestRank(sorted, 0.75);
}

export function estimatePoolEta({
  parallel,
  queuedCount,
  activeElapsedMs = [],
  completedDurationsMs = [],
  baselineDurationsMs = [],
} = {}) {
  if (!Number.isInteger(parallel) || parallel < 1) throw new Error("parallel deve ser um inteiro positivo.");
  if (!Number.isInteger(queuedCount) || queuedCount < 0) throw new Error("queuedCount deve ser um inteiro não negativo.");
  const active = sortedDurations(activeElapsedMs).slice(0, parallel);
  if (active.length === 0 && queuedCount === 0) {
    return { etaMs: 0, estimatedJobMs: null, source: "complete", sampleCount: 0 };
  }

  const current = sortedDurations(completedDurationsMs);
  const baseline = sortedDurations(baselineDurationsMs);
  const samples = current.length ? current : baseline;
  const source = current.length ? "current" : baseline.length ? "baseline" : "unavailable";
  let estimatedJobMs = durationEstimate(samples);
  if (estimatedJobMs === null) return { etaMs: null, estimatedJobMs: null, source, sampleCount: 0 };

  // Active jobs are right-censored samples: the estimate cannot be shorter
  // than the median amount of time jobs still running have already consumed.
  const activeMedian = summarizeMilliseconds(active).median;
  if (activeMedian !== null) estimatedJobMs = Math.max(estimatedJobMs, activeMedian);

  const lanes = Array.from({ length: parallel }, (_, index) => {
    const elapsed = active[index];
    if (elapsed === undefined) return 0;
    return elapsed < estimatedJobMs
      ? estimatedJobMs - elapsed
      : Math.max(1_000, estimatedJobMs * 0.25);
  });
  for (let index = 0; index < queuedCount; index += 1) {
    let lane = 0;
    for (let candidate = 1; candidate < lanes.length; candidate += 1) {
      if (lanes[candidate] < lanes[lane]) lane = candidate;
    }
    lanes[lane] += estimatedJobMs;
  }
  return {
    etaMs: rounded(Math.max(...lanes)),
    estimatedJobMs: rounded(estimatedJobMs),
    source,
    sampleCount: samples.length,
  };
}

export function formatDuration(milliseconds, { unknown = "calculando..." } = {}) {
  const value = nonnegativeNumber(milliseconds);
  if (value === null) return unknown;
  const totalSeconds = Math.round(value / 1_000);
  if (totalSeconds < 60) {
    const seconds = value < 10_000 ? (value / 1_000).toFixed(1).replace(".", ",") : String(totalSeconds);
    return `${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s` : `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

export function extractReceiptDeliveryMs(receipt) {
  const direct = nonnegativeNumber(receipt?.timings?.videoDeliveryMs ?? receipt?.timings?.totalMs);
  if (direct !== null) return { milliseconds: direct, source: "receipt-timings" };
  const started = Date.parse(receipt?.startedAt);
  const completed = Date.parse(receipt?.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
  return { milliseconds: completed - started, source: "receipt-envelope" };
}

function resultDeliveryDurations(summary) {
  return (summary?.results ?? [])
    .filter((result) => result?.ok)
    .map((result) => nonnegativeNumber(result?.timings?.videoDeliveryMs ?? result?.timings?.totalMs))
    .filter((value) => value !== null);
}

async function legacyReceiptDurations(summary, summaryFile) {
  const durations = [];
  for (const result of summary?.results ?? []) {
    if (!result?.ok || !result.receipt) continue;
    try {
      const receiptFile = path.isAbsolute(result.receipt) ? result.receipt : path.resolve(path.dirname(summaryFile), result.receipt);
      const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
      const timing = extractReceiptDeliveryMs(receipt);
      if (timing) durations.push(timing.milliseconds);
    } catch {
      // Historical output can be moved or partially archived; skip only the
      // unavailable receipt and continue looking for usable samples.
    }
  }
  return durations;
}

export async function loadLatestBatchBaseline(parentDir, { excludeDir = null } = {}) {
  const parent = path.resolve(parentDir);
  const excluded = excludeDir ? path.resolve(excludeDir).toLowerCase() : null;
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(parent, entry.name);
    if (excluded && directory.toLowerCase() === excluded) continue;
    const summaryFile = path.join(directory, "summary.json");
    try {
      const [raw, info] = await Promise.all([readFile(summaryFile, "utf8"), stat(summaryFile)]);
      const summary = JSON.parse(raw);
      const completed = Date.parse(summary.completedAt);
      candidates.push({ directory, summaryFile, summary, modifiedMs: Number.isFinite(completed) ? completed : info.mtimeMs });
    } catch {
      // Ignore directories that are not completed, readable batch outputs.
    }
  }
  candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
  for (const candidate of candidates) {
    let durations = resultDeliveryDurations(candidate.summary);
    let source = "summary-results";
    if (!durations.length) {
      durations = await legacyReceiptDurations(candidate.summary, candidate.summaryFile);
      source = "legacy-receipts";
    }
    if (!durations.length) {
      const median = nonnegativeNumber(candidate.summary?.timings?.jobs?.videoDeliveryMs?.median);
      if (median !== null) {
        durations = [median];
        source = "summary-median";
      }
    }
    if (durations.length) {
      return {
        batch: path.basename(candidate.directory),
        summaryFile: candidate.summaryFile,
        durationsMs: durations,
        sampleCount: candidate.summary?.timings?.jobs?.videoDeliveryMs?.count ?? durations.length,
        source,
      };
    }
  }
  return null;
}

export function buildJobTimingStats(results) {
  return Object.fromEntries(JOB_TIMING_FIELDS.map((field) => [
    field,
    summarizeMilliseconds(results.filter((result) => result?.ok).map((result) => result?.timings?.[field])),
  ]));
}

export function accumulatedWork(results) {
  let providerMs = 0;
  let nonProviderMs = 0;
  let count = 0;
  for (const result of results) {
    if (!result?.ok) continue;
    const delivery = nonnegativeNumber(result?.timings?.videoDeliveryMs ?? result?.timings?.totalMs);
    const provider = nonnegativeNumber(result?.timings?.providerMs);
    if (delivery === null || provider === null) continue;
    providerMs += Math.min(provider, delivery);
    nonProviderMs += Math.max(0, delivery - provider);
    count += 1;
  }
  const totalMs = providerMs + nonProviderMs;
  return {
    count,
    providerMs: rounded(providerMs),
    nonProviderMs: rounded(nonProviderMs),
    totalMs: rounded(totalMs),
    providerPercent: totalMs ? rounded((providerMs / totalMs) * 100, 2) : null,
    nonProviderPercent: totalMs ? rounded((nonProviderMs / totalMs) * 100, 2) : null,
    note: "Tempos acumulados dos jobs; fases paralelas se sobrepõem e não representam decomposição do wall clock.",
  };
}
