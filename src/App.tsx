import MapView from "./components/MapView";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <img src="./icon.svg" alt="" />
        <h1>
          Motorbike <span className="tag">Routenplaner</span>
        </h1>
      </header>
      <MapView />
    </div>
  );
}
