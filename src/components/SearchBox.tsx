import { useEffect, useRef, useState } from "react";
import { searchPlaces, type GeoResult } from "../lib/geocoding";

interface Props {
  onSelect: (result: GeoResult) => void;
}

export default function SearchBox({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const controllerRef = useRef<AbortController>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      try {
        const found = await searchPlaces(query.trim(), controller.signal);
        setResults(found);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const choose = (r: GeoResult) => {
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="searchbox">
      <div className="searchbox-input">
        <span className="search-icon">⌕</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Ort suchen – Start, Stopp, Ziel …"
          aria-label="Ort suchen"
        />
        {loading && <span className="search-spin" aria-hidden>…</span>}
      </div>

      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`} onClick={() => choose(r)}>
              {r.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
