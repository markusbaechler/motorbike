// Which field of the "Tour planen" form a point picked on the map fills.

export type PickTarget = "start" | "via" | "end";

export interface PickForm {
  startId: number;
  startFilled: boolean;
  // Per day: its stop slots in order (the last one is the day's destination).
  days: { id: number; stops: { id: number; filled: boolean }[] }[];
}

export type PickAction =
  | { kind: "fill"; id: number }
  // New Zwischenziel in front of the destination of this day.
  | { kind: "insertVia"; dayIndex: number };

/**
 * Plain click (no explicit target): the field the rider was just in, else the
 * first empty field (Start, then the stops in order), else a new Zwischenziel
 * before the final destination. Explicit targets from the context menu:
 * "start" = Start, "end" = destination of the last day, "via" = an empty
 * Zwischenziel of the last day or a new one.
 */
export function pickAction(form: PickForm, focusedId: number | null, target?: PickTarget): PickAction {
  const lastDi = form.days.length - 1;
  const lastDay = form.days[lastDi];
  if (target === "start") return { kind: "fill", id: form.startId };
  if (target === "end") return { kind: "fill", id: lastDay.stops[lastDay.stops.length - 1].id };
  if (target === "via") {
    const emptyVia = lastDay.stops.slice(0, -1).find((s) => !s.filled);
    return emptyVia ? { kind: "fill", id: emptyVia.id } : { kind: "insertVia", dayIndex: lastDi };
  }

  if (focusedId !== null) {
    const exists =
      focusedId === form.startId || form.days.some((d) => d.stops.some((s) => s.id === focusedId));
    if (exists) return { kind: "fill", id: focusedId };
  }
  if (!form.startFilled) return { kind: "fill", id: form.startId };
  for (const d of form.days) {
    const empty = d.stops.find((s) => !s.filled);
    if (empty) return { kind: "fill", id: empty.id };
  }
  return { kind: "insertVia", dayIndex: lastDi };
}

// Short label shown in the field until the place name has been looked up.
export const coordLabel = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
