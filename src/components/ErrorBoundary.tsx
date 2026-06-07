import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Catches render/runtime errors anywhere in the tree so a single bug can't
// leave the installed PWA on a blank white screen. Offers a reload.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a breadcrumb in the console for debugging.
    console.error("App-Fehler:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash-card">
            <h1>Da ist etwas schiefgelaufen</h1>
            <p>
              Die App ist auf einen unerwarteten Fehler gestoßen. Deine
              gespeicherten Routen bleiben erhalten.
            </p>
            <pre className="crash-detail">{this.state.error.message}</pre>
            <button className="export-btn primary" onClick={() => window.location.reload()}>
              Neu laden
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
