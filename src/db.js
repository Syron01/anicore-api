import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'anicore.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64 MB page cache
db.pragma('mmap_size = 268435456');

db.exec(`
CREATE TABLE IF NOT EXISTS media (
  kind            TEXT NOT NULL,
  anilist_id      INTEGER PRIMARY KEY,
  mal_id          INTEGER,
  kitsu_id        TEXT,
  title_romaji    TEXT,
  title_english   TEXT,
  title_native    TEXT,
  title_preferred TEXT NOT NULL,
  synonyms        TEXT,
  description     TEXT,
  format          TEXT,
  status          TEXT,
  episodes        INTEGER,
  chapters        INTEGER,
  volumes         INTEGER,
  duration        INTEGER,
  genres          TEXT,
  tags            TEXT,
  average_score   INTEGER,
  popularity      INTEGER,
  favourites      INTEGER,
  start_date      TEXT,
  end_date        TEXT,
  season          TEXT,
  season_year     INTEGER,
  country         TEXT,
  is_adult        INTEGER DEFAULT 0,
  source          TEXT,
  payload         TEXT NOT NULL,
  synced_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_kind_pop ON media(kind, popularity DESC);
CREATE INDEX IF NOT EXISTS idx_media_kind_score ON media(kind, average_score DESC);
CREATE INDEX IF NOT EXISTS idx_media_kind_season ON media(kind, season, season_year);
CREATE INDEX IF NOT EXISTS idx_media_mal ON media(mal_id);
CREATE INDEX IF NOT EXISTS idx_media_kitsu ON media(kitsu_id);
CREATE INDEX IF NOT EXISTS idx_media_title ON media(title_preferred);

CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
  title_preferred, title_english, title_romaji, title_native, synonyms,
  content='media', content_rowid='anilist_id', tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS extras (
  anilist_id INTEGER PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  kind    TEXT PRIMARY KEY,
  last_id INTEGER NOT NULL DEFAULT 0,
  total   INTEGER,
  running INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER
);
`);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO media
  (kind, anilist_id, mal_id, kitsu_id, title_romaji, title_english, title_native,
   title_preferred, synonyms, description, format, status, episodes, chapters,
   volumes, duration, genres, tags, average_score, popularity, favourites,
   start_date, end_date, season, season_year, country, is_adult, source,
   payload, synced_at)
  VALUES (@kind, @anilist_id, @mal_id, @kitsu_id, @title_romaji, @title_english,
   @title_native, @title_preferred, @synonyms, @description, @format, @status,
   @episodes, @chapters, @volumes, @duration, @genres, @tags, @average_score,
   @popularity, @favourites, @start_date, @end_date, @season, @season_year,
   @country, @is_adult, @source, @payload, @synced_at)
`);

const ftsInsert = db.prepare(`
  INSERT OR REPLACE INTO media_fts(rowid, title_preferred, title_english, title_romaji, title_native, synonyms)
  VALUES (@anilist_id, @title_preferred, @title_english, @title_romaji, @title_native, @synonyms)
`);

const deleteStmt = db.prepare('DELETE FROM media WHERE kind = @kind AND anilist_id = @anilist_id');
const deleteFts = db.prepare('DELETE FROM media_fts WHERE rowid = @anilist_id');

/** Persist a batch of normalized items inside one transaction (fast). */
export const saveMediaBatch = db.transaction((items) => {
  for (const item of items) {
    const row = flatten(item);
    deleteStmt.run({ kind: row.kind, anilist_id: row.anilist_id });
    deleteFts.run({ anilist_id: row.anilist_id });
    insertStmt.run(row);
    ftsInsert.run(row);
  }
});

function flatten(item) {
  return {
    kind: item.type === 'MANGA' ? 'MANGA' : 'ANIME',
    anilist_id: item.id.anilist,
    mal_id: item.id.myanimelist,
    kitsu_id: item.id.kitsu,
    title_romaji: item.title.romaji,
    title_english: item.title.english,
    title_native: item.title.native,
    title_preferred: item.title.userPreferred ?? item.title.romaji ?? 'Unknown',
    synonyms: JSON.stringify(item.title.synonyms ?? []),
    description: item.description,
    format: item.format,
    status: item.status,
    episodes: item.episodes,
    chapters: item.chapters,
    volumes: item.volumes,
    duration: item.durationMinutes,
    genres: JSON.stringify(item.genres ?? []),
    tags: JSON.stringify(item.tags ?? []),
    average_score: item.scores?.average ?? null,
    popularity: item.scores?.popularity ?? null,
    favourites: item.scores?.favorites ?? null,
    start_date: item.dates?.start,
    end_date: item.dates?.end,
    season: item.dates?.season,
    season_year: item.dates?.seasonYear,
    country: item.countryOfOrigin,
    is_adult: item.isAdult ? 1 : 0,
    source: item.source,
    payload: JSON.stringify(item),
    synced_at: Date.now(),
  };
}

export function getMediaById(kind, anilistId) {
  const row = db
    .prepare('SELECT payload FROM media WHERE kind = ? AND anilist_id = ?')
    .get(kind, anilistId);
  return row ? JSON.parse(row.payload) : null;
}

export function getMediaBulk(kind, ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT anilist_id, payload FROM media WHERE kind = ? AND anilist_id IN (${placeholders})`)
    .all(kind, ...ids);
  const byId = new Map(rows.map((r) => [r.anilist_id, JSON.parse(r.payload)]));
  return ids.map((id) => byId.get(id) ?? null);
}

/**
 * Full-text search against the local mirror. Falls back to LIKE for short
 * or heavily-accented queries where FTS ranking misses.
 */
export function searchMedia(kind, q, { page = 1, perPage = 20 } = {}) {
  const limit = perPage;
  const offset = (page - 1) * perPage;
  const ftsQuery = q.split(/\s+/).filter(Boolean).map((w) => `${w}*`).join(' ');
  const rows = db
    .prepare(`
      SELECT m.payload FROM media_fts f
      JOIN media m ON m.anilist_id = f.rowid
      WHERE media_fts MATCH ? AND m.kind = ?
      ORDER BY bm25(media_fts) ASC, m.popularity DESC
      LIMIT ? OFFSET ?
    `)
    .all(ftsQuery, kind, limit, offset);
  if (rows.length > 0) return { items: rows.map((r) => JSON.parse(r.payload)), total: null };
  const like = `%${q}%`;
  const rows2 = db
    .prepare(`
      SELECT payload FROM media
      WHERE kind = ? AND (title_preferred LIKE ? OR title_english LIKE ? OR title_romaji LIKE ? OR title_native LIKE ?)
      ORDER BY popularity DESC LIMIT ? OFFSET ?
    `)
    .all(kind, like, like, like, like, limit, offset);
  return { items: rows2.map((r) => JSON.parse(r.payload)), total: null };
}

export function topMedia(kind, { page = 1, perPage = 20, by = 'score' } = {}) {
  const order = by === 'popularity' ? 'popularity DESC' : 'average_score DESC';
  const rows = db
    .prepare(
      `SELECT payload FROM media WHERE kind = ? ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(kind, perPage, (page - 1) * perPage);
  return rows.map((r) => JSON.parse(r.payload));
}

export function seasonMedia(kind, { year, season, page = 1, perPage = 20 } = {}) {
  const rows = db
    .prepare(
      `SELECT payload FROM media WHERE kind = ? AND lower(season) = ? AND season_year = ?
       ORDER BY popularity DESC LIMIT ? OFFSET ?`,
    )
    .all(kind, season, year, perPage, (page - 1) * perPage);
  return rows.map((r) => JSON.parse(r.payload));
}

export function dbStats() {
  const counts = db
    .prepare(`SELECT kind, COUNT(*) as n FROM media GROUP BY kind`)
    .all();
  const state = db.prepare('SELECT * FROM sync_state').all();
  return { counts, sync: state };
}

/* ---------------------------- extras cache ----------------------------- */
/* characters / relations / recommendations, cached forever (they change
   rarely) so a second detail click is a pure local read. */

export function getExtras(anilistId) {
  const row = db.prepare('SELECT payload FROM extras WHERE anilist_id = ?').get(anilistId);
  return row ? JSON.parse(row.payload) : null;
}

export const setExtras = db.transaction((anilistId, payload) => {
  db.prepare(`
    INSERT OR REPLACE INTO extras (anilist_id, payload, fetched_at)
    VALUES (?, ?, ?)
  `).run(anilistId, JSON.stringify(payload), Date.now());
});

export function extrasCount() {
  return db.prepare('SELECT COUNT(*) n FROM extras').get().n;
}
