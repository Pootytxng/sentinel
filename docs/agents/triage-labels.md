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

## Note on this repo's existing labels

`wontfix` already exists on `Pootytxng/sentinel`; the other four do not and will be created on first
use. The repo's own `lane:*` (who owns the work) and `gate:*` (what it is blocked on) labels are a
**different axis** and are not substitutes — in particular `gate:kuya` means *owner-only decision*,
which is narrower than `ready-for-human`. Apply both axes where both apply.
