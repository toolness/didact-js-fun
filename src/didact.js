// Didact — your own tiny React.
// Following https://pomb.us/build-your-own-react/
//
// This file is intentionally empty — you're writing it from scratch.
//
// The only fixed contract is the shape of the default export: your JSX
// compiles to `Didact.createElement(...)` and `Didact.Fragment` (see
// vite.config.js), and src/main.jsx calls `Didact.render(...)`. So whatever
// you build, the object you export needs those keys. Everything else — how
// they work — is up to you.
//
// Roadmap from the post:
//   Step I    — createElement
//   Step II   — render
//   Step III  — Concurrent Mode
//   Step IV   — Fibers
//   Step V    — Render and Commit phases
//   Step VI   — Reconciliation
//   Step VII  — Function Components
//   Step VIII — Hooks (useState)

function createElement(type, props, ...children) {
  throw new Error("Didact.createElement: not implemented yet — Step I");
}

function render(element, container) {
  throw new Error("Didact.render: not implemented yet — Step II");
}

const Fragment = "FRAGMENT";

const Didact = {
  createElement,
  render,
  Fragment,
};

export default Didact;
