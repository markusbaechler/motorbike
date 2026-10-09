import { useEffect, useState } from "react";
import { onThrottle } from "./queue";

/**
 * Seconds until the request queue goes on again because the public routing
 * server limits requests (0 = not waiting). Counts down once per second, so
 * the UI can say "geht in 25 s weiter" instead of showing an error.
 */
export function useThrottleWait(): number {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => onThrottle((u) => {
    setUntil(u);
    setNow(Date.now());
  }), []);

  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);

  return until > now ? Math.ceil((until - now) / 1000) : 0;
}
