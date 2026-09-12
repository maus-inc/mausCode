// Atoms
export {
  chatSearchCountInfoAtom,
  chatSearchCurrentIndexAtom,
  chatSearchCurrentMatchAtom,
  chatSearchInputAtom,
  chatSearchMatchesAtom,
  chatSearchOpenAtom,
  chatSearchQueryAtom,
  closeSearchAtom,
  goToNextMatchAtom,
  goToPrevMatchAtom,
  type HighlightRange,
  highlightRangesAtomFamily,
  openSearchAtom,
  type SearchMatch,
  toggleSearchAtom,
} from "./chat-search-atoms"
// Components
export { ChatSearchBar } from "./chat-search-bar"
// Utils
export {
  debounce,
  extractSearchableText,
  findMatches,
  splitTextByHighlights,
  type TextSegment,
} from "./chat-search-utils"

// Context
export {
  SearchHighlightProvider,
  useIsSearchActive,
  useSearchHighlight,
  useSearchHighlightContext,
  useSearchQuery,
} from "./search-highlight-context"
