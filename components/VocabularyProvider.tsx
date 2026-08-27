"use client";

import { createContext, useContext } from "react";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/vocabulary";

/**
 * The workspace's vocabulary (S5 tab 1), handed down to the client tree.
 *
 * A context rather than a prop chain because the strings are needed by leaf
 * components — a form label, a legend row, a toolbar button — that otherwise
 * have no reason to know about workspace config. The default is the shipped
 * vocabulary, so a component rendered outside a provider still reads sensibly
 * rather than blanking.
 */
const VocabularyContext = createContext<Vocabulary>(DEFAULT_VOCABULARY);

export function VocabularyProvider({
  vocabulary,
  children,
}: {
  vocabulary: Vocabulary;
  children: React.ReactNode;
}) {
  return (
    <VocabularyContext.Provider value={vocabulary}>{children}</VocabularyContext.Provider>
  );
}

export const useVocabulary = () => useContext(VocabularyContext);
