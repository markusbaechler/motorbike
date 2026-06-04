import { useEffect, useRef, useState } from "react";
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
 */
export default function PlaceInput({ value, placeholder, bias, onChange, onPick }: Props) {
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  // Pre-filled values (editing an existing route) start as "already chosen",
  // so we don't immediately fire a search and pop the dropdown open.
  const justPicked = useRef(value.length > 0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const controllerRef = useRef<AbortController>();

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    clearTimeout(debounceRef.current);
    if (value.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const found = await searchPlaces(value.trim(), controller.signal, bias);
        setResults(found);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  const choose = (r: GeoResult) => {
    justPicked.current = true;
    onPick(r);
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="place-input">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <ul className="place-results">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`} onMouseDown={() => choose(r)}>
              {r.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
