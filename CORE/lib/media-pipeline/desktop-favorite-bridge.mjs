import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importExternalFavoriteEvents } from "./archive-index.mjs";

export function defaultDesktopCatalogFile(localAppData = process.env.LOCALAPPDATA) {
  return localAppData ? path.join(localAppData, "GeradorDeVideos", "Acervo", "catalog.sqlite") : null;
}

export function syncDesktopFavoriteEvents({ catalogFile = defaultDesktopCatalogFile(), preferencesDbFile } = {}) {
  if (!catalogFile || !existsSync(catalogFile)) return { schema: "mkt-videos/desktop-favorite-sync@1", available: false, imported: 0, skipped: 0, providerCalls: 0 };
  const sourceDb = new DatabaseSync(path.resolve(catalogFile), { readOnly: true });
  try {
    const table = sourceDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='favorite_events'").get();
    if (!table) return { schema: "mkt-videos/desktop-favorite-sync@1", available: true, imported: 0, skipped: 0, providerCalls: 0 };
    const rows = sourceDb.prepare("SELECT id,rel_path AS relPath,liked,occurred_at AS occurredAt FROM favorite_events ORDER BY id").all();
    const result = importExternalFavoriteEvents({ dbFile: preferencesDbFile, source: "tauri-catalog", events: rows.map((row) => ({ sourceEventId: row.id, relPath: row.relPath, liked: Boolean(row.liked), occurredAt: row.occurredAt })) });
    return { schema: "mkt-videos/desktop-favorite-sync@1", available: true, sourceEvents: rows.length, imported: result.imported, skipped: result.skipped, providerCalls: 0 };
  } finally {
    sourceDb.close();
  }
}
