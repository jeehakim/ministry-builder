import { useRef } from "react";

/**
 * A ref that always holds the value from the most recent render. Async work (an
 * AI call that returns seconds later) reads it so it applies results through the
 * current callback rather than one that closed over stale form state.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
