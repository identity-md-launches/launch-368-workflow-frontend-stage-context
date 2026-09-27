import { createRoot } from "react-dom/client";
import App from "./App";
import { loadRuntime } from "./config";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="boot">
    <h1>Lockvote</h1>
    <p role="status">Loading the deployment record…</p>
  </main>,
);
loadRuntime()
  .then((runtime) => root.render(<App runtime={runtime} />))
  .catch((error) =>
    root.render(
      <main className="boot">
        <h1>Deployment unavailable</h1>
        <p role="alert">{error.message}</p>
        <button onClick={() => location.reload()}>Reload deployment</button>
      </main>,
    ),
  );
