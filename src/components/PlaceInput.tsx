import { useEffect, useId, useRef, useState } from "react";
import { searchPlaces, type GeoResult } from "../lib/geocoding";

interface Props {
  value: string;
  placeholder: string;
  bias?: { lat: number; lng: number };
  onChange: (value: string) => void;
  onPick: (result: GeoResult) => void;
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
export default function PlaceInput({ value, placeholder, bias, onChange, onPick }: Props) {
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const typed = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const controllerRef = useRef<AbortController>();

  const stopLookup = () => {
    clearTimeout(debounceRef.current);
    controllerRef.current?.abort();
  };

  useEffect(() => {
    if (!typed.current) return;
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
        const found = await searchPlaces(value.trim(), controller.signal, bias);
        if (controller.signal.aborted) return;
        setResults(found);
        setOpen(true);
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
    setOpen(false);
    setActive(-1);
  };

  const visible = open && results.length > 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    } else if (e.key === "Enter") {
      if (active >= 0 && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
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
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
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
        <ul id={listId} role="listbox" className="place-results">
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
