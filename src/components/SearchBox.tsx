import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon";
import { enterAction, searchPlaces, type GeoResult } from "../lib/geocoding";
import { getRecentPlaces, addRecentPlace } from "../lib/storage";

interface Props {
  onSelect: (result: GeoResult) => void;
  // Rank hits near the tour first (last stop, or the map's home area).
  bias?: { lat: number; lng: number };
}

export default function SearchBox({ onSelect, bias }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  // The text the shown results belong to (the list lags behind typing).
  const [resultsFor, setResultsFor] = useState("");
  const biasRef = useRef(bias);
  biasRef.current = bias;
  const [recents, setRecents] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Keyboard-highlighted entry (-1 = none).
  const [active, setActive] = useState(-1);
  const listId = useId();

  const showRecents = query.trim().length < 3 && results.length === 0 && recents.length > 0;
  const items = showRecents ? recents : results;
  const visible = open && items.length > 0;

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const controllerRef = useRef<AbortController>();

  // Stop both the pending debounce and an in-flight request, so a late answer
  // can't reopen the list after the field was cleared or a result was chosen.
  const stopLookup = () => {
    clearTimeout(debounceRef.current);
    controllerRef.current?.abort();
    setLoading(false);
  };

  useEffect(() => {
    stopLookup();
    setActive(-1);
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      try {
        const q = query.trim();
        const found = await searchPlaces(q, controller.signal, biasRef.current);
        if (controller.signal.aborted) return;
        setResults(found);
        setResultsFor(q);
        // Don't pop the list under a field the rider already left.
        if (document.activeElement === inputRef.current) setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => () => stopLookup(), []);

  const choose = (r: GeoResult) => {
    stopLookup();
    addRecentPlace({ name: r.name, lat: r.lat, lng: r.lng });
    onSelect(r);
    setQuery("");
    setResults([]);
    setResultsFor("");
    setOpen(false);
    setActive(-1);
  };

  // Enter while the list still shows hits for an older input: search the
  // current text right away and take its first hit.
  const searchNowAndPick = async () => {
    stopLookup();
    const controller = new AbortController();
    controllerRef.current = controller;
    const q = query.trim();
    setLoading(true);
    try {
      const found = await searchPlaces(q, controller.signal, biasRef.current);
      if (controller.signal.aborted) return;
      if (found[0]) choose(found[0]);
      else {
        setResults([]);
        setResultsFor(q);
      }
    } catch {
      // Network trouble: leave the field as it is; the rider can retry.
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  // The list belongs to an older input while the new one is being looked up.
  const stale = !showRecents && results.length > 0 && resultsFor !== query.trim();

  const onFocus = () => {
    setRecents(getRecentPlaces());
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Highlighted entry, the first one of an up-to-date list, or a fresh
      // search when the list still belongs to an older input.
      const action = enterAction({
        active: visible ? active : -1,
        count: items.length,
        resultsFor: showRecents ? query.trim() : resultsFor,
        query,
      });
      if (action === "none") return;
      e.preventDefault();
      if (action === "pick-active") choose(items[active]);
      else if (action === "pick-first") choose(items[0]);
      else void searchNowAndPick();
      return;
    }
    if (!visible) {
      if (e.key === "ArrowDown" && items.length > 0) {
        e.preventDefault();
        setOpen(true);
        setActive(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="searchbox">
      <div className="searchbox-input">
        <Icon name="search" size={20} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={onFocus}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Ort suchen – Start, Zwischenziel, Ziel …"
          aria-label="Ort suchen"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={listId}
          aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
        />
        {loading && <span className="search-spin" aria-hidden>…</span>}
      </div>

      {visible && (
        <ul id={listId} role="listbox" className={`search-results ${stale ? "stale" : ""}`}>
          {showRecents && (
            <li className="search-recent-head" role="presentation">
              Zuletzt
            </li>
          )}
          {items.map((r, i) => (
            <li
              key={`${r.lat},${r.lng},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
            >
              {/* mousedown is prevented so the input keeps focus (no blur race). */}
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
              >
                {showRecents && <Icon name="search" size={14} className="search-recent-icon" />}
                {r.name}
                {r.kind && <span className="place-kind">{r.kind}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
