import { useState } from "react";
import type { BookingPrefs } from "../lib/storage";

interface Props {
  prefs: BookingPrefs;
  onSave: (prefs: BookingPrefs) => void;
  onClose: () => void;
}

function Stepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="stepper-row">
      <span className="stepper-label">{label}</span>
      <div className="stepper">
        <button className="wp-btn" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span className="stepper-val">{value}</span>
        <button className="wp-btn" onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

export default function BookingPrefsModal({ prefs, onSave, onClose }: Props) {
  const [adults, setAdults] = useState(prefs.adults);
  const [children, setChildren] = useState(prefs.children);
  const [rooms, setRooms] = useState(prefs.rooms);
  const [affiliateId, setAffiliateId] = useState(prefs.affiliateId ?? "");

  const save = () => {
    onSave({ adults, children, rooms, affiliateId: affiliateId.trim() || undefined });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Reisende & Zimmer</h2>
          <button className="modal-close" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-note" style={{ marginTop: 0 }}>
            Gilt für alle Übernachtungen der Tour – wird gespeichert.
          </p>
          <Stepper label="Erwachsene" value={adults} min={1} onChange={setAdults} />
          <Stepper label="Kinder" value={children} min={0} onChange={setChildren} />
          <Stepper label="Zimmer" value={rooms} min={1} onChange={setRooms} />

          <div className="modal-section" style={{ marginTop: 12 }}>
            <label className="default-label" htmlFor="aid">
              Booking.com Affiliate-ID (optional)
            </label>
            <input
              id="aid"
              className="day-name-input"
              type="text"
              placeholder="z. B. 1234567"
              value={affiliateId}
              onChange={(e) => setAffiliateId(e.target.value)}
              style={{ width: "100%", marginTop: 6 }}
            />
            <p className="modal-note">Nur nötig, wenn du an Buchungen mitverdienen willst.</p>
          </div>

          <button className="export-btn primary" onClick={save}>Speichern</button>
        </div>
      </div>
    </div>
  );
}
