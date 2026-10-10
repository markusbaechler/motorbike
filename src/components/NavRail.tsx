import Icon, { type IconName } from "./Icon";
import { SITE_LINKS } from "../config";

export type Section = "tour" | "genius" | "passes" | "club" | "routes";

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
  // Club tours come from the website; absent on the old hosting.
  clubTours: boolean;
  canInstall: boolean;
  onInstall: () => void;
}

const ITEMS: { id: Section; icon: IconName; label: string; title: string }[] = [
  { id: "tour", icon: "route", label: "Tour", title: "Aktuelle Tour" },
  { id: "genius", icon: "compass", label: "Genius", title: "Tour-Genius: Touren automatisch generieren" },
  { id: "passes", icon: "mountain", label: "Pässe", title: "Pässeplaner: Tour über ausgewählte Pässe" },
  { id: "club", icon: "users", label: "Club", title: "Club-Touren der Pudgilly Riders" },
  { id: "routes", icon: "folder", label: "Meine", title: "Meine gespeicherten Touren" },
];

/**
 * Desktop navigation: a narrow column at the far left with every tool of the
 * planner. The chosen tool opens in the sidebar next to it; the map beside
 * stays visible. Phones keep the start screen and the bottom sheet instead.
 */
export default function NavRail({ active, onSelect, clubTours, canInstall, onInstall }: Props) {
  return (
    <nav className="nav-rail" aria-label="Routenplaner">
      <button className="nav-rail-logo" onClick={() => onSelect("tour")} aria-label="Zur aktuellen Tour">
        <img src="./logo.png" alt="" />
      </button>
      {ITEMS.filter((it) => it.id !== "club" || clubTours).map((it) => (
        <button
          key={it.id}
          className={`nav-rail-item ${active === it.id ? "active" : ""}`}
          onClick={() => onSelect(it.id)}
          aria-current={active === it.id ? "page" : undefined}
          title={it.title}
        >
          <Icon name={it.icon} size={21} />
          <span>{it.label}</span>
        </button>
      ))}
      <span className="nav-rail-spacer" />
      {canInstall && (
        <button className="nav-rail-item quiet" onClick={onInstall} title="Als App installieren">
          <Icon name="download" size={18} />
          <span>App</span>
        </button>
      )}
      {/* target=_top: inside the website's iframe this replaces the whole page. */}
      <a className="nav-rail-item quiet" href={SITE_LINKS.home} target="_top" title="Zur Website pudgilly.ch">
        <Icon name="globe" size={18} />
        <span>Website</span>
      </a>
    </nav>
  );
}
