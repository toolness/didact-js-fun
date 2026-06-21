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

const TEXT_ELEMENT = "TEXT_ELEMENT";

function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map(child => typeof child === "object" ? child : createTextElement(child))
    }
  }
}

function createTextElement(text) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: []
    }
  }
}

function render(element, container) {
  const dom = element.type === TEXT_ELEMENT ? document.createTextNode("") : document.createElement(element.type);
  const isProperty = key => key !== "children";
  Object.keys(element.props).filter(isProperty).forEach(name => {
    dom[name] = element.props[name];
  });
  element.props.children.forEach(child => render(child, dom));
  container.appendChild(dom);
}

const Fragment = "FRAGMENT";

const Didact = {
  createElement,
  render,
  Fragment,
};

export default Didact;
