import PassPlanner from "./components/PassPlanner";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <img src="./icon.svg" alt="" />
        <h1>
          Motorbike <span className="tag">Pässeplaner</span>
        </h1>
      </header>
      <PassPlanner />
    </div>
  );
}
