import { useEffect, useState } from "react";

/** True while the given CSS media query matches; updates on resize/rotate. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// From this width on the planner shows a sidebar instead of the bottom sheet
// (must match the @media rule in styles.css).
export const DESKTOP_QUERY = "(min-width: 900px)";
