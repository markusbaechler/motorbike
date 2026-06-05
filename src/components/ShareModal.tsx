import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Icon from "./Icon";
import { buildShareUrl } from "../lib/share";
import type { Waypoint } from "../types";

interface Props {
  waypoints: Waypoint[];
  onClose: () => void;
}

export default function ShareModal({ waypoints, onClose }: Props) {
  const url = buildShareUrl(waypoints);
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
      await navigator.share?.({ title: "Motorradtour", text: "Meine Route in Motorbike", url });
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Route teilen</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Der Link enthält die ganze Tour (Stopps, Profile, Tage) – kein Konto nötig.
            Wer ihn öffnet, sieht die Route direkt im Planer.
          </p>

          {qr && (
            <div className="share-qr">
              <img src={qr} alt="QR-Code zur Route" />
            </div>
          )}

          <div className="share-url">{url}</div>

          <button className="export-btn primary" onClick={copy}>
            <Icon name="folder" size={16} /> {copied ? "Link kopiert ✓" : "Link kopieren"}
          </button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button className="export-btn" style={{ width: "100%", marginTop: 8 }} onClick={nativeShare}>
              Teilen …
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
