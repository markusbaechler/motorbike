import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Icon from "./Icon";
import Modal from "./Modal";
import { buildShareUrl, type ShareStats } from "../lib/share";
import type { Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  // Routed totals, if the route is computed; they ride along in the link.
  stats?: ShareStats;
  onClose: () => void;
}

export default function ShareModal({ waypoints, stats, onClose }: Props) {
  const url = buildShareUrl(waypoints, stats);
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 260, color: { dark: "#111111", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share?.({
        title: "Tour · Pudgilly Riders Routenplaner",
        text: "Meine Tour im Routenplaner der Pudgilly Riders",
        url,
      });
    } catch {
      /* cancelled */
    }
  };

  return (
    <Modal title="Tour teilen" onClose={onClose}>
      <div className="modal-body">
        <p className="modal-note" style={{ marginTop: 0 }}>
          Der Link enthält die ganze Tour (Punkte, Fahrstile, Tage) – kein Konto nötig.
          Wer ihn öffnet, sieht die Tour direkt im Planer.
        </p>

        {qr && (
          <div className="share-qr">
            <img src={qr} alt="QR-Code zur Route" />
          </div>
        )}

        <div className="share-url">{url}</div>

        <button className="export-btn primary" onClick={copy}>
          <Icon name={copied ? "check" : "link"} size={16} /> {copied ? "Link kopiert" : "Link kopieren"}
        </button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button className="export-btn" style={{ width: "100%", marginTop: 8 }} onClick={nativeShare}>
            Teilen …
          </button>
        )}
        <p className="modal-note">
          Derselbe Link ist auch der «Planer-Link» für eine Club-Tour auf der Website
          (Pages CMS → Club-Touren).
        </p>
      </div>
    </Modal>
  );
}
