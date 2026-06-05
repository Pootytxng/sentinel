import { createContext, useContext } from "react";

// Lets any surface (e.g. an inline <Term> glossary tooltip) open the knowledge library, optionally
// focused on a specific entry id. Provided once at the App root. Default is a no-op so components
// render safely outside a provider (tests, isolation).
export type LibraryApi = { openLibrary: (focusId?: string) => void };

export const LibraryContext = createContext<LibraryApi>({ openLibrary: () => {} });

export const useLibrary = () => useContext(LibraryContext);
