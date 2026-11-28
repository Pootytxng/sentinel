# Triage Labels

The skills speak in terms of seven canonical triage roles: two category roles and five state roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in supermatt | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `bug`                      | `bug`                | Something is broken                      |
| `enhancement`              | `enhancement`        | New feature or improvement               |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the `ready-for-agent` triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Repo notes

Labels missing on `Pootytxng/sentinel` are created on first use (`gh label create "<name>" --force`).

These seven are **separate from** the repo's existing ownership vocabulary (`lane:*`, `gate:*`, `work-control`). A `gate:kuya` issue is owner-gated regardless of its triage label; never substitute one family for the other. **Apply both axes where both apply**: an issue can be `ready-for-human` (triage state) and `gate:kuya` (owner-only decision) at once.
