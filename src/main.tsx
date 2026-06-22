// `Didact` MUST be in scope here: vite compiles the JSX below into
// Didact.createElement(...) calls (see vite.config.js). If you remove this
// import you'll get "Didact is not defined" at runtime.
//
// This file is .tsx (not .jsx), so it's fully type-checked: the JSX is
// validated against Didact's own types via src/jsx.d.ts, and Didact.render
// is checked against its real signature.
import Didact from "./didact.ts";
import "./style.css";
// Installs the fiber-graph visualizer (globalThis.__didactTrace). Must come
// before render() so the work loop is already being traced. Pure side-effect
// import — delete this line to turn the visualization off.
import "./instrument.js";
// Installs the commit-flash overlay (globalThis.__didactCommit). Highlights
// added/changed DOM nodes on commit. Pure side-effect import — delete to disable.
import "./debug-overlay.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("expected a #root element to render into");
}

function IntroComponent(props: { frameworkName: string }) {
  return <h1>Hello from {props.frameworkName} 👋</h1>;
}

// This is plain JSX — but it does NOT become React.createElement.
// It becomes Didact.createElement. That's the whole point.
const rerender = (value: string, count: number) => {
  const element = (
    <div id="app">
      <IntroComponent frameworkName="Didact" />
      <p>
        This JSX was transpiled to <code>Didact.createElement</code>, not React.
      </p>
      <input onInput={(e) => rerender(e.target.value.toUpperCase(), count)} value={value} />
      <p>
        Count is <span>{count}</span>
      </p>
      <button onClick={() => rerender(value, count + 1)}>Increment</button>
    </div>
  );
  Didact.render(element, container);
};

rerender("HALLO", 0);
