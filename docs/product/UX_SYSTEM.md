# UX System

**Derived from:** `../PRODUCT_CONSTITUTION.md`

Compy's UX must make powerful PC tooling feel like one understandable conversation.

## 1. Core law

**Simple outside, deep inside.**

Compy may be technically sophisticated without forcing that sophistication onto the user's first decision.

## 2. User-facing decisions

Ask users only things they can reasonably know:

- what outcome they care about;
- what game/workload they care about;
- whether they want conservative/recommended/aggressive risk;
- whether a tradeoff is acceptable once Compy explains it.

Do not ask a normal user to select low-level Windows mechanisms as the primary path.

## 3. Progressive disclosure

Every material conclusion should support three depths:

1. **Answer** — concise recommendation/result.
2. **Explanation** — why it applies to this machine and what tradeoff exists.
3. **Technical receipt** — exact mechanism, state, evidence, methodology, and provenance.

The same truth powers all three.

## 4. Intent routing

The UI should route from user intent/context, not from knowledge of internal rooms.

Primary intents include:

- make my PC perform better;
- something went wrong;
- check how my PC is doing;
- compare a change;
- understand my PC / learn why.

Rooms/instruments can remain a visual/navigation language, but users should not need to know where a capability lives before Compy can guide them.

## 5. Default behavior

A user who cannot choose an optimization target gets **Recommended / Best Overall Experience**.

Compy explains the inferred target rather than forcing a technical setup wizard.

## 6. Tradeoff presentation

Translate technical cost into human consequences:

- more FPS but more heat;
- lower latency but reduced visual quality;
- slightly more performance with materially lower stability confidence;
- no meaningful gain, so Compy recommends keeping the default.

Do not hide tradeoffs behind generic warning icons.

## 7. Risk presentation

Risk language should be calm and specific.

Good:

> This setting may improve sustained CPU boost, but your test showed only a 1 FPS gain while temperature rose 8°C.

Bad:

> DANGER! ADVANCED TWEAK!

## 8. Contextual education

Teach concepts when they explain a real observation or decision on the user's machine.

Tooltips define terms. They do not carry the entire educational burden.

After a result, explain what the user just learned from their own evidence.

## 9. 3D rig

The rig visualization should communicate reasoning:

- highlight implicated hardware when evidence supports it;
- recede irrelevant hardware;
- show system-level relationships when they matter;
- avoid decorative callouts that compete with the current decision.

## 10. Scores and severity

Do not use arbitrary health/performance scores as if they are objective truth.

If a score exists, its meaning must be defensible and secondary to concrete facts.

“14 of 16 checks passed; two are worth reviewing” is often better than “88 — FAIR.”

## 11. Notifications

Interrupt only for:

- material incidents;
- meaningful state changes;
- invalidated baselines;
- decisions the user actually needs to make;
- safety/stability conditions.

Do not use notification volume as an engagement metric.

## 12. Completion

A successful screen/session should make it obvious:

- what Compy believes;
- what evidence supports it;
- what the user should do next;
- what will change if they accept;
- how it gets restored;
- when no action is needed.

## 13. Anti-goals

Avoid:

- expert-jargon-first screens;
- duplicated basic/advanced products;
- tooltip mazes;
- room hunting;
- severity inflation;
- “magic button” opacity;
- ornamental instrumentation that does not improve comprehension;
- forcing users to understand implementation mechanisms before receiving value.
