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

// We're just going to perform a fixed amount of work before giving control back to the browser, it makes it easier to see this thing working in practice.
const UNIT_OF_WORK_CHUNK_SIZE = 1;

// make it big so we can really see it happen
const MS_BETWEEN_CHUNKS = 250;

let nextUnitOfWork = null;

let wipRoot = null;

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

function createDom(fiber) {
  const dom = fiber.type === TEXT_ELEMENT ? document.createTextNode("") : document.createElement(fiber.type);
  const isProperty = key => key !== "children";
  Object.keys(fiber.props).filter(isProperty).forEach(name => {
    dom[name] = fiber.props[name];
  });
  return dom;
}

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    }
  };
  nextUnitOfWork = wipRoot;
  workLoop();
}

function commitWork(fiber) {
  if (fiber.parent) {
    fiber.parent.dom.appendChild(fiber.dom);
  }

  if (fiber.child) {
    commitWork(fiber.child);
  }

  if (fiber.sibling) {
    commitWork(fiber.sibling);
  }
}

function workLoop() {
  let shouldYield = false;
  let unitsOfWorkDoneThisChunk = 0;
  while (nextUnitOfWork && !shouldYield) {
    unitsOfWorkDoneThisChunk += 1;
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = unitsOfWorkDoneThisChunk >= UNIT_OF_WORK_CHUNK_SIZE;
  }
  if (!nextUnitOfWork && wipRoot) {
    commitWork(wipRoot);
    wipRoot = null;
  }
  setTimeout(workLoop, MS_BETWEEN_CHUNKS);
}

function performUnitOfWork(fiber) {
  // [viz hook] No-op unless the visualizer (src/instrument.js) is loaded.
  // Safe to delete — nothing in Didact depends on it.
  globalThis.__didactTrace?.(fiber);

  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  const elements = fiber.props.children;
  let index = 0;
  let prevSibling = null;

  while (index < elements.length) {
    const element = elements[index];

    const newFiber = {
      type: element.type,
      props: element.props,
      parent: fiber,
      dom: null,
    };

    if (index === 0) {
      fiber.child = newFiber;
    } else {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }

  if (fiber.child) {
    return fiber.child;
  }

  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

const Fragment = "FRAGMENT";

const Didact = {
  createElement,
  render,
  Fragment,
};

export default Didact;
