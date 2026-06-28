# Compy

An all-in-one PC optimization & **safety** dashboard for the everyday, non-technical gamer —
*"a rollback-first Windows configuration safety layer that happens to optimize."* Compy reads the
actual PC and tailors safe, reversible settings to **your** hardware, in plain English, instead of
generic "best tweaks" that break things.

> Built with **Tauri 2** (Rust core in `src-tauri/`) + **React/TypeScript** frontend (`src/`).
> App identifier `gg.compy.app`, data dir `%APPDATA%\Compy`.
> (The git repo is still named `sentinel` — the public rename is deferred; this is expected.)

## Where to start

| You want… | Read |
| --- | --- |
| The project brief + resume point (auto-loads for Claude Code) | [`CLAUDE.md`](CLAUDE.md) |
| **Current** gate/build/release state (single source of truth) | [`docs/RELEASE_STATE.md`](docs/RELEASE_STATE.md) |
| What's next (the living status ledger) | [`docs/BACKLOG.md`](docs/BACKLOG.md) |
| Product direction & monetization doctrine | [`docs/RECEIPTS_DOCTRINE.md`](docs/RECEIPTS_DOCTRINE.md) |
| The non-negotiable safety constraints | [`docs/ARCHITECTURE_LOCKS.md`](docs/ARCHITECTURE_LOCKS.md) |

## Dev loop

```bash
npm install
npm run tauri dev      # run the desktop app (debug)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests
npm test               # frontend tests
npm run tauri build    # produce the installer (NSIS + MSI)
```

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
