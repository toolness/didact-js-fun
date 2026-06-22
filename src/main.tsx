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

function App() {
  const [value, setValue] = Didact.useState("HALLO");
  const [count, setCount] = Didact.useState(0);

  return (
    <div id="app">
      <IntroComponent frameworkName="Didact" />
      <p>
        For more information on what this is all about, see the <a href="https://github.com/toolness/didact-js-fun#readme" target="_blank">GitHub README</a>.
      </p>
      <input onInput={(e) => 
        setValue(
          // Note that this is actually retrieving the value at the time
          // that the callback is called, which may be different from the
          // value it had at the time that the user typed. For the purposes
          // of this demo app that's fine though.
          () => e.target.value.toUpperCase()
        )
      } value={value} />
      <p>
        Count is <span>{count}</span>
      </p>
      <button onClick={() => setCount((count) => count + 1)}>Increment</button>
    </div>
  );
}

Didact.render(<App />, container);
