// Quiet Pit Wall component contracts (issue #49). Import from here, never from the file
// directly, so the surface stays one auditable list as rooms are ported.
//
//   GLANCE    Verdict · Reading · ActionRow/Action
//   PROOF     EvidenceChip
//   ADVANCED  Disclosure
//
// The stylesheet is scoped [data-qpw="on"] and is imported once by App.tsx; these components
// render inert (unstyled, but structurally correct and accessible) until that flag is set.

export {
  EvidenceChip,
  Disclosure,
  Verdict,
  Reading,
  Action,
  ActionRow,
  type EvidenceState,
  type ActionVariant,
} from "./contracts";
