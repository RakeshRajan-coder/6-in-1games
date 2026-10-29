import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const profileId = "local-player";
const supportedGames = new Set(["chess", "carrom", "ludo", "snakes", "business", "cue"]);
const supportedModes = new Set(["offline", "online", "lan"]);
const supportedStatuses = new Set(["setup", "active", "completed", "abandoned"]);

export class LedgerValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LedgerValidationError(`${label} must be a JSON object.`);
  }
  try {
    return JSON.stringify(value);
  } catch {
    throw new LedgerValidationError(`${label} must be serializable as JSON.`);
  }
}

function matchFromRow(row, includeSnapshot = false) {
  if (!row) return null;
  const match = {
    id: row.id,
    profileId: row.profile_id,
    gameId: row.game_id,
    ruleset: row.ruleset,
    mode: row.mode,
    playerCount: row.player_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSnapshot) match.snapshot = JSON.parse(row.snapshot_json);
  return match;
}

function eventFromRow(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    sequence: row.sequence,
    type: row.event_type,
    playerId: row.player_id,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at,
  };
}

export function openLedger(databasePath) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (databasePath !== ":memory:") database.exec("PRAGMA journal_mode = WAL;");

  const version = database.prepare("PRAGMA user_version").get().user_version;
  if (version < 1) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE profiles (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 40),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE matches (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          game_id TEXT NOT NULL CHECK(game_id IN ('chess', 'carrom', 'ludo', 'snakes', 'business', 'cue')),
          ruleset TEXT,
          mode TEXT NOT NULL CHECK(mode IN ('offline', 'online', 'lan')),
          player_count INTEGER NOT NULL CHECK(player_count BETWEEN 2 AND 6),
          status TEXT NOT NULL CHECK(status IN ('setup', 'active', 'completed', 'abandoned')),
          snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE match_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL CHECK(sequence > 0),
          event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 80),
          player_id TEXT,
          payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
          created_at TEXT NOT NULL,
          UNIQUE(match_id, sequence)
        );

        CREATE INDEX matches_by_profile_updated ON matches(profile_id, updated_at DESC);
        CREATE INDEX match_events_by_match_sequence ON match_events(match_id, sequence);
        PRAGMA user_version = 1;
      `);
      database.prepare(`
        INSERT INTO profiles (id, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(profileId, "Player One", new Date().toISOString(), new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      database.close();
      throw error;
    }
  }

  const getProfileStatement = database.prepare("SELECT id, display_name, created_at, updated_at FROM profiles WHERE id = ?");
  const getMatchStatement = database.prepare("SELECT * FROM matches WHERE id = ? AND profile_id = ?");
  const listMatchesStatement = database.prepare(`
    SELECT * FROM matches WHERE profile_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT ?
  `);

  return {
    close() {
      database.close();
    },

    getProfile() {
      const row = getProfileStatement.get(profileId);
      return { id: row.id, displayName: row.display_name, createdAt: row.created_at, updatedAt: row.updated_at };
    },

    updateProfile(displayName) {
      if (typeof displayName !== "string" || displayName.trim().length < 1 || displayName.trim().length > 40) {
        throw new LedgerValidationError("Display name must contain 1 to 40 characters.");
      }
      const updatedAt = new Date().toISOString();
      database.prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE id = ?")
        .run(displayName.trim(), updatedAt, profileId);
      return this.getProfile();
    },

    listMatches(limit = 100) {
      const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 100;
      return listMatchesStatement.all(profileId, boundedLimit).map((row) => matchFromRow(row));
    },

    getMatch(id) {
      return matchFromRow(getMatchStatement.get(id, profileId), true);
    },

    createMatch(input) {
      const gameId = input?.gameId;
      const mode = input?.mode;
      const status = input?.status ?? "setup";
      const playerCount = input?.playerCount;
      const ruleset = input?.ruleset ?? null;
      if (!supportedGames.has(gameId)) throw new LedgerValidationError("Unsupported game.");
      if (!supportedModes.has(mode)) throw new LedgerValidationError("Mode must be offline, online, or lan.");
      if (!supportedStatuses.has(status)) throw new LedgerValidationError("Unsupported match status.");
      if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
        throw new LedgerValidationError("Player count must be between 2 and 6.");
      }
      if (ruleset !== null && (typeof ruleset !== "string" || ruleset.length > 32)) {
        throw new LedgerValidationError("Ruleset must be a string of at most 32 characters.");
      }
      const snapshotJson = requireRecord(input.snapshot, "Match snapshot");
      const id = randomUUID();
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO matches (id, profile_id, game_id, ruleset, mode, player_count, status, snapshot_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, profileId, gameId, ruleset, mode, playerCount, status, snapshotJson, now, now);
      return this.getMatch(id);
    },

    updateMatch(id, input) {
      const existing = getMatchStatement.get(id, profileId);
      if (!existing) return null;
      const status = input?.status ?? existing.status;
      if (!supportedStatuses.has(status)) throw new LedgerValidationError("Unsupported match status.");
      const snapshotJson = input?.snapshot === undefined
        ? existing.snapshot_json
        : requireRecord(input.snapshot, "Match snapshot");
      const updatedAt = new Date().toISOString();
      database.prepare(`
        UPDATE matches SET status = ?, snapshot_json = ?, updated_at = ? WHERE id = ? AND profile_id = ?
      `).run(status, snapshotJson, updatedAt, id, profileId);
      return this.getMatch(id);
    },

    deleteMatch(id) {
      return database.prepare("DELETE FROM matches WHERE id = ? AND profile_id = ?").run(id, profileId).changes > 0;
    },

    appendEvent(matchId, input) {
      const type = input?.type;
      const playerId = input?.playerId ?? null;
      if (typeof type !== "string" || type.trim().length < 1 || type.trim().length > 80) {
        throw new LedgerValidationError("Event type must contain 1 to 80 characters.");
      }
      if (playerId !== null && (typeof playerId !== "string" || playerId.length > 80)) {
        throw new LedgerValidationError("Player ID must be a string of at most 80 characters.");
      }
      const payloadJson = requireRecord(input.payload ?? {}, "Event payload");
      database.exec("BEGIN IMMEDIATE");
      try {
        if (!getMatchStatement.get(matchId, profileId)) {
          database.exec("ROLLBACK");
          return null;
        }
        const sequence = database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM match_events WHERE match_id = ?").get(matchId).next_sequence;
        const createdAt = new Date().toISOString();
        const result = database.prepare(`
          INSERT INTO match_events (match_id, sequence, event_type, player_id, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(matchId, sequence, type.trim(), playerId, payloadJson, createdAt);
        database.exec("COMMIT");
        return eventFromRow(database.prepare("SELECT * FROM match_events WHERE id = ?").get(result.lastInsertRowid));
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    listMatchEvents(matchId) {
      if (!getMatchStatement.get(matchId, profileId)) return null;
      return database.prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY sequence ASC").all(matchId).map(eventFromRow);
    },
  };
}