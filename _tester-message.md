## Message to the six 0.9.0 invitees

Copy from the line below. Send it however you normally reach them.
After they install, the 20-minute walkthrough is `docs/BETA_TESTER_README.md`
(Health · Live · History · Test — not the old six-room names).

---

Hey — quick one about Compy.

The build I sent you a while back (0.9.0) is old and it can't update itself.
Everything since then has gone out through Compy's own updater, and you're not
on that path yet.

One install fixes it for good:

**https://github.com/Pootytxng/compy-releases/releases/latest**

Grab the `.exe`, run it over what you have. Nothing gets wiped — your history
and settings stay. After this one, Compy checks for updates on its own and
asks before it does anything. You can turn that off in Settings → About if
you'd rather.

When it opens, stay on the first screen (Health). Don't hunt for old room
names.

Two honest heads-ups:

1. Windows will throw a blue "unrecognized app" box. That's because I haven't
   paid for a code signing certificate yet, not because anything's wrong.
   Click **More info → Run anyway**.
2. Compy talks to GitHub to check for updates and nothing else. No account, no
   telemetry, no data leaving your machine. It's in the privacy doc if you
   want to read it.

If it breaks, tell me exactly what you were doing when it did. That's worth
more to me than a "works fine."

---

### Notes for you (not part of the message)

- The link is the `latest` alias, so it stays correct after every future
  release. Don't paste a versioned URL — it goes stale the next time we ship.
- **Current latest is 0.9.26** (`Compy_0.9.26_x64-setup.exe`, SHA-256
  `4B72D681…4E98`, published 2026-08-19). Do not send 0.9.0, 0.9.11, or any
  Drive link.
- **What this buys you:** six unknowns become six known installs on 0.9.26,
  and the consent-first update path gets tested at n=7 instead of n=1. Right
  now exactly one tester has ever used it (they landed on 0.9.11).
- **What to watch for:** if more than one of them reports the update check
  failing, that is a real signal and it goes straight to the top of the queue.
- 20-minute ask after they install: first screen verdict → Gaming Mode *or*
  one undoable apply → play borderless → Live debrief → undo. Not a tour of
  Test / experiments.
- Record whatever comes back in `docs/BETA_DISTRIBUTION_RECORD.md` — that file
  is the only place tester state is tracked, and it currently still says 0.9.0
  for all six.
