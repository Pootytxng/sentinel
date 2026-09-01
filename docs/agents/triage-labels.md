# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label
string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## State as of 2026-08-31

Only `wontfix` exists on `Pootytxng/sentinel` today (it is a GitHub default). The other four are
created on first use — `gh label create <name>`.

These five are **separate from** the repo's existing ownership vocabulary (`lane:*`, `gate:*`,
`work-control`), which is defined by `docs/WORK_CONTROL.md` and is not a triage state. A `gate:kuya`
issue is owner-gated regardless of which triage label it carries; never substitute one family for
the other. **Apply both axes where both apply** — an issue can be `ready-for-human` (triage state)
and `gate:kuya` (owner-only decision) at once, and dropping either loses real information.
