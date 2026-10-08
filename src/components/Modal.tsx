import { useEffect, useId, useRef, type ReactNode } from "react";
import Icon from "./Icon";

interface Props {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  // Extra class on the dialog box (e.g. "modal-lg", "modal-pass").
  className?: string;
  // Extra class on the backdrop (e.g. "info-backdrop" for a nested dialog).
  backdropClassName?: string;
  closeLabel?: string;
}

// Open dialogs, innermost last. Only the top-most one reacts to Escape so a
// nested dialog doesn't close its parent along with itself.
const stack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog shell shared by all modals: dialog role + label, Escape
 * to close, focus kept inside while open, focus returned to the opener on
 * close, backdrop click closes.
 */
export default function Modal({
  title,
  onClose,
  children,
  className = "",
  backdropClassName = "",
  closeLabel = "Schliessen",
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const token = Symbol("modal");
    stack.push(token);
    const opener = document.activeElement as HTMLElement | null;
    // Focus the dialog itself (not the first input: on phones that would pop
    // the keyboard over half the sheet). Tab then moves into the content.
    boxRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && boxRef.current) {
        const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === boxRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className={`modal-backdrop ${backdropClassName}`} onClick={onClose}>
      <div
        ref={boxRef}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label={closeLabel}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
