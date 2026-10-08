/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Booking.com affiliate id (optional, build-time). See .env.example.
  readonly VITE_BOOKING_AID?: string;
  // New address of the planner, set on the old hosting only. See config.ts.
  readonly VITE_MOVED_TO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
