// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://pudgilly.ch',
  // Statische Ausgabe nach ./dist – wird per rsync auf das green.ch Webhosting deployt.
  output: 'static',
  build: {
    // Saubere URLs: /touren statt /touren.html
    format: 'directory',
  },
  // Der Routenplaner liegt nicht in src/pages, sondern wird im Workflow nach
  // dist/planer/ gebaut. Für die Sitemap darum von Hand eintragen.
  integrations: [sitemap({ customPages: ['https://pudgilly.ch/planer/'] })],
  // Übergangsweise: die alte Planer-Adresse leitet auf die neue um (Astro legt
  // dafür eine kleine Weiterleitungsseite in dist/touren/ ab). Entfällt, sobald
  // /touren/ wieder eine eigene Seite ist (Club-Touren).
  redirects: {
    '/touren/': '/planer/',
  },
});
