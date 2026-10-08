import type { ReactNode } from "react";
import Modal from "./Modal";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  // Destructive actions get the red confirm button.
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small yes/no dialog for actions that would throw work away. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Abbrechen",
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal title={title} onClose={onCancel} className="modal-confirm" backdropClassName="confirm-backdrop">
      <div className="modal-body">
        <div className="confirm-text">{children}</div>
        <div className="confirm-actions">
          <button className="export-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`export-btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
