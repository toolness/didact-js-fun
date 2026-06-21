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

type Fiber = {
  type: ElementType | null,
  parent: Fiber | null,
  child: Fiber | null,
  sibling: Fiber | null,
  props: Props,
  dom: HTMLElement | Text | null
}

export type ElementType = keyof HTMLElementTagNameMap | typeof TEXT_ELEMENT

export type Element = {
  type: ElementType;
  props: Props
}

export type Props = {
  children: Element[],
  [k: string]: any
}

const TEXT_ELEMENT = "TEXT_ELEMENT";

// We're just going to perform a fixed amount of work before giving control back to the browser, it makes it easier to see this thing working in practice.
const UNIT_OF_WORK_CHUNK_SIZE = 1;

// make it big so we can really see it happen
const MS_BETWEEN_CHUNKS = 250;

let nextUnitOfWork: Fiber|null = null;

let wipRoot: Fiber|null = null;

let isInitialized = false;

function createElement(type: string, props: Omit<Props, "children">, ...children: Array<Element|string>) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child),
      ),
    },
  };
}

function createTextElement(text: string) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

function createDom(fiber: Fiber) {
  if (fiber.type === null) {
    throw new Error("fiber type must be defined");
  }
  const dom =
    fiber.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(fiber.type);
  const isProperty = (key: string) => key !== "children";
  Object.keys(fiber.props)
    .filter(isProperty)
    .forEach((name) => {
      // TODO: Don't cast to `any` here.
      (dom as any)[name] = fiber.props[name];
    });
  return dom;
}

function render(element: Element, container: HTMLElement) {
  wipRoot = {
    type: null,
    parent: null,
    child: null,
    sibling: null,
    dom: container,
    props: {
      children: [element],
    },
  };
  nextUnitOfWork = wipRoot;
  if (!isInitialized) {
    isInitialized = true;
    setTimeout(workLoop, 0);
  }
}

function commitWork(fiber: Fiber) {
  if (!fiber.dom) {
    throw new Error("fiber must have dom")
  }

  if (fiber.parent) {
    if (!fiber.parent.dom) {
      throw new Error("fiber parent must have dom")
    }
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

function performUnitOfWork(fiber: Fiber): Fiber | null {
  // [viz hook] No-op unless the visualizer (src/instrument.js) is loaded.
  // Safe to delete — nothing in Didact depends on it.
  globalThis.__didactTrace?.(fiber);

  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  const elements = fiber.props.children;
  let index = 0;
  let prevSibling: Fiber|null = null;

  while (index < elements.length) {
    const element = elements[index];

    const newFiber: Fiber = {
      type: element.type,
      props: element.props,
      parent: fiber,
      child: null,
      sibling: null,
      dom: null,
    };

    if (index === 0) {
      fiber.child = newFiber;
    } else {
      if (!prevSibling) {
        throw new Error("prevSibling must be defined")
      }
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }

  if (fiber.child) {
    return fiber.child;
  }

  let nextFiber: Fiber|null = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }

  return null
}

const Fragment = "FRAGMENT";

const Didact = {
  createElement,
  render,
  Fragment,
};

export default Didact;
