// `Didact` MUST be in scope here: vite compiles the JSX below into
// Didact.createElement(...) calls (see vite.config.js). If you remove this
// import you'll get "Didact is not defined" at runtime.
import Didact from "./didact.ts";
import "./style.css";
// Installs the fiber-graph visualizer (globalThis.__didactTrace). Must come
// before render() so the work loop is already being traced. Pure side-effect
// import — delete this line to turn the visualization off.
import "./instrument.js";

const container = document.getElementById("root");

// This is plain JSX — but it does NOT become React.createElement.
// It becomes Didact.createElement. That's the whole point.
const rerender = (value, count) => {
  const element = (
    <div id="app">
      <h1>Hello from Didact 👋</h1>
      <p>
        This JSX was transpiled to <code>Didact.createElement</code>, not React.
      </p>
      <input onInput={(e) => rerender(e.target.value.toUpperCase(), count)} value={value} />
      <p>
        Count is <span>{count}</span>
      </p>
      <button onClick={(e) => rerender(value, count + 1)}>Increment</button>
    </div>
  );
  Didact.render(element, container);
}

rerender("HALLO", 0);
