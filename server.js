import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LedgerValidationError, openLedger } from "./src/ledger.js";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const databasePath = process.env.SIXFOLD_DB_PATH || join(root, "data", "sixfold.sqlite");
const ledger = openLedger(databasePath);
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);
const maxBodyBytes = 2 * 1024 * 1024;

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBodyBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    return sendJson(response, 200, { status: "ok", storage: "sqlite" });
  }

  if (url.pathname === "/api/profile") {
    if (request.method === "GET") return sendJson(response, 200, { profile: ledger.getProfile() });
    if (request.method === "PUT") {
      const body = await readJson(request);
      return sendJson(response, 200, { profile: ledger.updateProfile(body.displayName) });
    }
  }

  if (url.pathname === "/api/matches") {
    if (request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 100);
      return sendJson(response, 200, { matches: ledger.listMatches(limit) });
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      return sendJson(response, 201, { match: ledger.createMatch(body) });
    }
  }

  const matchPath = url.pathname.match(/^\/api\/matches\/([0-9a-f-]+)(?:\/(events))?$/i);
  if (matchPath) {
    const [, matchId, eventsPath] = matchPath;
    if (eventsPath && request.method === "GET") {
      const events = ledger.listMatchEvents(matchId);
      return events ? sendJson(response, 200, { events }) : sendJson(response, 404, { error: "Match not found." });
    }
    if (eventsPath && request.method === "POST") {
      const body = await readJson(request);
      const event = ledger.appendEvent(matchId, body);
      return event ? sendJson(response, 201, { event }) : sendJson(response, 404, { error: "Match not found." });
    }
    if (!eventsPath && request.method === "GET") {
      const match = ledger.getMatch(matchId);
      return match ? sendJson(response, 200, { match }) : sendJson(response, 404, { error: "Match not found." });
    }
    if (!eventsPath && request.method === "PUT") {
      const body = await readJson(request);
      const match = ledger.updateMatch(matchId, body);
      return match ? sendJson(response, 200, { match }) : sendJson(response, 404, { error: "Match not found." });
    }
    if (!eventsPath && request.method === "DELETE") {
      return ledger.deleteMatch(matchId)
        ? sendJson(response, 200, { deleted: true })
        : sendJson(response, 404, { error: "Match not found." });
    }
  }

  return sendJson(response, 404, { error: "Not found." });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    const staticFile = staticFiles.get(url.pathname);
    if (!staticFile || !["GET", "HEAD"].includes(request.method)) {
      return sendJson(response, 404, { error: "Not found." });
    }
    const [fileName, contentType] = staticFile;
    const content = await readFile(join(root, fileName));
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    if (error instanceof LedgerValidationError) return sendJson(response, 400, { error: error.message });
    if (error.status) return sendJson(response, error.status, { error: error.message });
    console.error(error);
    return sendJson(response, 500, { error: "Internal server error." });
  }
});

server.listen(port, host, () => {
  console.log(`Sixfold game room listening on http://localhost:${port}`);
  console.log(`SQLite ledger: ${databasePath}`);
});

function shutDown() {
  server.close(() => {
    ledger.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);