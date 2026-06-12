import { KNOWLEDGE_BY_ID } from "../data/knowledge";

// "What's this?" cross-link (wayfinding §3) — a quiet affordance on a rec/toggle/graded row that opens
// the EXACT Learn entry resolved by id via the Library quick-look overlay (its sanctioned surviving
// role), so the user never has to leave + type-search. Renders nothing when no entry resolves by that
// id — we don't show a dead link. onOpen is the existing libraryApi.openLibrary(focusId).
export function WhatsThis({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  if (!KNOWLEDGE_BY_ID.has(id)) return null;
  return (
    <button
      type="button"
      className="whats-this"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(id);
      }}
      title="What's this? — open the Blackbook entry"
    >
      What's this?
    </button>
  );
}
