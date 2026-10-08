/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Booking.com affiliate id (optional, build-time). See .env.example.
  readonly VITE_BOOKING_AID?: string;
  // New address of the planner, set on the old hosting only. See config.ts.
  readonly VITE_MOVED_TO?: string;
  // Where the planner loads the club tours from (default: pudgilly.ch/touren.json).
  readonly VITE_CLUB_TOURS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
