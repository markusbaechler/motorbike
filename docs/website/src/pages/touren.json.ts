import type { APIRoute } from 'astro';
import { tours } from '../data/touren';
import { today } from '../data/events';

// Club-Touren als JSON für den Routenplaner (pudgilly.ch/planer/ → «Club-Touren»).
// Wird beim Build nach dist/touren.json geschrieben.
export const GET: APIRoute = () => {
  const body = {
    v: 1,
    generated: today,
    tours: tours.map((t) => ({
      slug: t.slug,
      title: t.title,
      region: t.region,
      level: t.level,
      description: t.description,
      highlights: t.highlights,
      distanceKm: t.distanceKm,
      durationMin: t.durationMin,
      days: t.days,
      daysLabel: t.daysLabel,
      code: t.code,
      url: `https://pudgilly.ch/touren/#${t.slug}`,
      next: t.next ? { date: t.next.date, label: t.next.shortLabel } : null,
    })),
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
