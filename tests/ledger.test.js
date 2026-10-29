import assert from "node:assert/strict";
import test from "node:test";
import { openLedger, LedgerValidationError } from "../src/ledger.js";

function makeLedger() {
  return openLedger(":memory:");
}

function makeMatch(overrides = {}) {
  return {
    gameId: "chess",
    ruleset: "standard",
    mode: "offline",
    playerCount: 2,
    snapshot: { board: "initial", turn: "white" },
    ...overrides,
  };
}

test("creates a local profile and persists profile name updates", (context) => {
  const ledger = makeLedger();
  context.after(() => ledger.close());

  assert.equal(ledger.getProfile().displayName, "Player One");
  assert.equal(ledger.updateProfile("  Mira  ").displayName, "Mira");
  assert.equal(ledger.getProfile().displayName, "Mira");
});

test("saves, lists, and updates a match snapshot", (context) => {
  const ledger = makeLedger();
  context.after(() => ledger.close());

  const created = ledger.createMatch(makeMatch());
  assert.equal(created.gameId, "chess");
  assert.equal(created.status, "setup");
  assert.deepEqual(created.snapshot, { board: "initial", turn: "white" });
  assert.equal(ledger.listMatches().length, 1);

  const updated = ledger.updateMatch(created.id, {
    status: "active",
    snapshot: { board: "after-move", turn: "black" },
  });
  assert.equal(updated.status, "active");
  assert.deepEqual(updated.snapshot, { board: "after-move", turn: "black" });
  assert.equal(ledger.getMatch("missing"), null);
});

test("rejects unsupported or incomplete match records", (context) => {
  const ledger = makeLedger();
  context.after(() => ledger.close());

  assert.throws(() => ledger.createMatch(makeMatch({ gameId: "unknown" })), LedgerValidationError);
  assert.throws(() => ledger.createMatch(makeMatch({ playerCount: 1 })), LedgerValidationError);
  assert.throws(() => ledger.createMatch(makeMatch({ snapshot: [] })), LedgerValidationError);
  assert.equal(ledger.listMatches().length, 0);
});

test("appends ordered match events and cascades them on delete", (context) => {
  const ledger = makeLedger();
  context.after(() => ledger.close());

  const match = ledger.createMatch(makeMatch());
  const first = ledger.appendEvent(match.id, { type: "move", playerId: "white", payload: { from: "e2", to: "e4" } });
  const second = ledger.appendEvent(match.id, { type: "turn", payload: { player: "black" } });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(ledger.listMatchEvents(match.id).map((event) => event.sequence), [1, 2]);
  assert.equal(ledger.deleteMatch(match.id), true);
  assert.deepEqual(ledger.listMatchEvents(match.id), null);
  assert.equal(ledger.deleteMatch(match.id), false);
});