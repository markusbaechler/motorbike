import { useEffect, useId, useRef, useState } from "react";
import { enterAction, searchPlaces, type GeoResult } from "../lib/geocoding";

interface Props {
  value: string;
  placeholder: string;
  bias?: { lat: number; lng: number };
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onPick: (result: GeoResult) => void;
  onFocus?: () => void;
}

/**
 * A text field with place autocomplete that keeps its chosen value (unlike
 * the header SearchBox, which clears after selecting). Used in the quick-plan
 * dialog, one per stop. An optional `bias` keeps results near a reference
 * point (e.g. the previous stop) for contiguous routes.
 *
 * Only text the rider actually typed triggers a lookup: values set by the
 * parent (pre-filled stops, the resolved name after a pick) never reopen the
 * suggestion list.
 */
export default function PlaceInput({ value, placeholder, bias, autoFocus, onChange, onPick, onFocus }: Props) {
  const [results, setResults] = useState<GeoResult[]>([]);
  // The text the shown results belong to (the list lags behind typing).
  const [resultsFor, setResultsFor] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const typed = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const controllerRef = useRef<AbortController>();

  const stopLookup = () => {
    clearTimeout(debounceRef.current);
    controllerRef.current?.abort();
  };

  useEffect(() => {
    if (!typed.current) {
      // Value set by the parent (pre-fill, resolved name): no lookup, and any
      // list still open belongs to the previous text.
      stopLookup();
      setOpen(false);
      return;
    }
    typed.current = false;
    stopLookup();
    setActive(-1);
    if (value.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const q = value.trim();
        const found = await searchPlaces(q, controller.signal, bias);
        if (controller.signal.aborted) return;
        setResults(found);
        setResultsFor(q);
        // Don't pop the list under a field the rider already left.
        if (document.activeElement === inputRef.current) setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // Nothing may arrive after the field is gone.
  useEffect(() => () => stopLookup(), []);

  const choose = (r: GeoResult) => {
    stopLookup();
    onPick(r);
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
    const q = value.trim();
    try {
      const found = await searchPlaces(q, controller.signal, bias);
      if (controller.signal.aborted) return;
      if (found[0]) choose(found[0]);
      else {
        setResults([]);
        setResultsFor(q);
      }
    } catch {
      // Network trouble: keep the typed text; "Tour erstellen" resolves it.
    }
  };

  const visible = open && results.length > 0;
  // The list belongs to an older input while the new one is being looked up.
  const stale = results.length > 0 && resultsFor !== value.trim();

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Highlighted suggestion, the first one of an up-to-date list ("Sion"
      // + Enter is enough), or a fresh search for an outdated list.
      const action = enterAction({ active: visible ? active : -1, count: results.length, resultsFor, query: value });
      if (action === "none") return;
      e.preventDefault();
      if (action === "pick-active") choose(results[active]);
      else if (action === "pick-first") choose(results[0]);
      else void searchNowAndPick();
      return;
    }
    if (!visible) {
      if (e.key === "ArrowDown" && results.length > 0) {
        e.preventDefault();
        setOpen(true);
        setActive(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Escape") {
      // Only swallow Escape while the list is open; otherwise the dialog closes.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="place-input">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => {
          onFocus?.();
          if (results.length > 0) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
      />
      {visible && (
        <ul id={listId} role="listbox" className={`place-results ${stale ? "stale" : ""}`}>
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lng},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
              >
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
