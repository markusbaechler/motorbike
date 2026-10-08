/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Booking.com affiliate id (optional, build-time). See .env.example.
  readonly VITE_BOOKING_AID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
