# Sixfold

An offline-first game room for Chess, Carrom, Ludo, Snakes and Ladders, Business Board, 8-ball Pool, and Snooker.

## Run locally

Requires Node.js 24 or newer. The ledger uses Node's built-in SQLite module; no database package or network connection is required.

```sh
npm start
```

Open http://localhost:4173. The SQLite database is created at `data/sixfold.sqlite` on first launch. Set `PORT` or `SIXFOLD_DB_PATH` to override the defaults. The local API binds to loopback by default; do not expose it to an untrusted network without adding authentication.

Run the ledger tests with:

```sh
npm test
```

## Local ledger

The SQLite ledger tracks the local profile, saved match setup/state snapshots, and ordered match events. It enables foreign keys and write-ahead logging for the on-disk database. Database files and SQLite sidecars are excluded from version control.

The same-origin API exposes `GET` and `PUT /api/profile`, `GET` and `POST /api/matches`, `GET`, `PUT`, and `DELETE /api/matches/:id`, plus `GET` and `POST /api/matches/:id/events`. The game-room UI stores and loads saved setups through this API.
