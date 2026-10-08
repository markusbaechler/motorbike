import { useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
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
        <button className="wp-btn" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label}: weniger`}><Icon name="minus" size={16} /></button>
        <span className="stepper-val">{value}</span>
        <button className="wp-btn" onClick={() => onChange(value + 1)} aria-label={`${label}: mehr`}><Icon name="plus" size={16} /></button>
      </div>
    </div>
  );
}

// The club's Booking.com affiliate id is set at build time (config.ts), so
// this dialog only asks for travellers and rooms.
export default function BookingPrefsModal({ prefs, onSave, onClose }: Props) {
  const [adults, setAdults] = useState(prefs.adults);
  const [children, setChildren] = useState(prefs.children);
  const [rooms, setRooms] = useState(prefs.rooms);

  const save = () => {
    onSave({ adults, children, rooms, affiliateId: prefs.affiliateId });
    onClose();
  };

  return (
    <Modal title="Reisende & Zimmer" onClose={onClose}>
      <div className="modal-body">
        <p className="modal-note" style={{ marginTop: 0 }}>
          Gilt für alle Übernachtungen der Tour – wird auf diesem Gerät gespeichert.
        </p>
        <Stepper label="Erwachsene" value={adults} min={1} onChange={setAdults} />
        <Stepper label="Kinder" value={children} min={0} onChange={setChildren} />
        <Stepper label="Zimmer" value={rooms} min={1} onChange={setRooms} />

        <button className="export-btn primary" style={{ marginTop: 14 }} onClick={save}>
          Speichern
        </button>
      </div>
    </Modal>
  );
}
