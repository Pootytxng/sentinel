# Compy

Compy is a guided PC performance, optimization, health, diagnosis, recovery, experimentation, and education system for Windows users.

Its two flagship journeys are:

- **MAKE THIS PC BETTER**
- **FIGURE OUT WHAT WENT WRONG**

The product law is simple:

> **The user chooses the destination. Compy handles the technical route, proves the result, explains the tradeoffs, and never hides the way back.**

> **Compy optimizes outcomes, not settings.**

Compy is built to read the actual machine, reason about what is relevant to that hardware/workload, use safe reversible experiments where supported, measure the result, keep what helps, restore what does not, and retain enough evidence to explain later problems. What is actually built, armed, installed, or verified today is [`docs/RELEASE_STATE.md`](docs/RELEASE_STATE.md) truth, not this paragraph.

Built with **Tauri 2** (Rust core in `src-tauri/`) + **React/TypeScript** frontend (`src/`). The GitHub repository retains the historical name `sentinel`.

## Authority stack

| Domain | Authority |
| --- | --- |
| Product identity, UX, strategy, priorities | [`docs/PRODUCT_CONSTITUTION.md`](docs/PRODUCT_CONSTITUTION.md) |
| Safety, rollback, privilege, immutable architecture | [`docs/ARCHITECTURE_LOCKS.md`](docs/ARCHITECTURE_LOCKS.md) |
| Current build/release truth | [`docs/RELEASE_STATE.md`](docs/RELEASE_STATE.md) |
| Active writer/claim truth | [`docs/WORK_CONTROL.md`](docs/WORK_CONTROL.md) |
| Derived product sequence | [`docs/product/ROADMAP.md`](docs/product/ROADMAP.md) |
| Living execution status | [`docs/BACKLOG.md`](docs/BACKLOG.md) |

Legacy `RECEIPTS_DOCTRINE.md`, historical PRDs, old Product Direction files, and pre-rebirth roadmaps are historical evidence only and do not define current product direction.

## Reborn product architecture

- [`docs/product/OPTIMIZATION_ENGINE.md`](docs/product/OPTIMIZATION_ENGINE.md)
- [`docs/product/MACHINE_MODEL.md`](docs/product/MACHINE_MODEL.md)
- [`docs/product/TRIAL_PROTOCOL.md`](docs/product/TRIAL_PROTOCOL.md)
- [`docs/product/RISK_MODEL.md`](docs/product/RISK_MODEL.md)
- [`docs/product/CARE_ENGINE.md`](docs/product/CARE_ENGINE.md)
- [`docs/product/UX_SYSTEM.md`](docs/product/UX_SYSTEM.md)
- [`docs/product/VALIDATION.md`](docs/product/VALIDATION.md)
- [`docs/product/MONETIZATION.md`](docs/product/MONETIZATION.md)
- [`docs/product/COMPETITIVE_POSITIONING.md`](docs/product/COMPETITIVE_POSITIONING.md)
- [`docs/product/SUPERSESSION_MANIFEST.md`](docs/product/SUPERSESSION_MANIFEST.md)

## Dev loop

```bash
npm install
npm run tauri dev
cargo test --manifest-path src-tauri/Cargo.toml
npm test
npm run tauri build
```
