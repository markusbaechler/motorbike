import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { searchPlaces, type GeoResult } from "../lib/geocoding";
import { getRecentPlaces, addRecentPlace } from "../lib/storage";

interface Props {
  onSelect: (result: GeoResult) => void;
}

export default function SearchBox({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [recents, setRecents] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const showRecents = open && query.trim().length < 3 && results.length === 0 && recents.length > 0;

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
    addRecentPlace({ name: r.name, lat: r.lat, lng: r.lng });
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const onFocus = () => {
    setRecents(getRecentPlaces());
    setOpen(true);
  };

  return (
    <div className="searchbox">
      <div className="searchbox-input">
        <Icon name="search" size={20} className="search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={onFocus}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
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

      {showRecents && (
        <ul className="search-results">
          <li className="search-recent-head">Zuletzt</li>
          {recents.map((r, i) => (
            <li key={`rec-${i}`} onClick={() => choose(r)}>
              <Icon name="search" size={14} className="search-recent-icon" /> {r.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
