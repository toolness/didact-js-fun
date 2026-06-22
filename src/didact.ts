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
  alternate: Fiber | null,
  effectTag: EffectTag | null,
  props: Props,
  dom: HTMLElement | Text | null
}

type EffectTag = "UPDATE" | "PLACEMENT" | "DELETION";

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

export type Config = {
  unitOfWorkChunkSize: number;
  msBetweenChunks: number;
};

const DEFAULT_CONFIG: Config = {
  unitOfWorkChunkSize: 1,
  msBetweenChunks: 1
}

let config: Config = DEFAULT_CONFIG;

let nextUnitOfWork: Fiber|null = null;

let wipRoot: Fiber | null = null;

let currentRoot: Fiber | null = null;

let deletions: Fiber[] = [];

let isInitialized = false;

function setConfig(newConfig: Config) {
  config = newConfig;
}

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
  updateDom(dom, { children: [] }, fiber.props);
  return dom;
}

function setDOMProperty(dom: HTMLElement | Text, property: string, props: Props | null) {
  // TODO: Don't cast to `any` here.
  let anyDom: any = dom;

  debugLog("setDOMProperty", dom, property, props && props[property]);

  if (props === null) {
    anyDom[property] = "";
  } else {
    anyDom[property] = props[property];
  }
}

function debugLog(...args: any[]) {
  console.log("Didact:", ...args);
}

function render(element: Element, container: HTMLElement) {
  debugLog("Starting render.");
  wipRoot = {
    type: null,
    parent: null,
    child: null,
    sibling: null,
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
    effectTag: null
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
  if (!isInitialized) {
    isInitialized = true;
    setTimeout(workLoop, 0);
  }
}

function unreachable(thing: never) {
  throw new Error("unreachable code reached! wut");
}

function commitWork(fiber: Fiber) {
  if (!fiber.dom) {
    throw new Error("fiber must have dom")
  }

  if (!fiber.parent?.dom) {
    throw new Error("fiber parent must exist and have dom");
  }

  if (!fiber.effectTag) {
    throw new Error("fiber must have an effect tag");
  }

  const domParent = fiber.parent.dom;

  switch (fiber.effectTag) {
    case "PLACEMENT":
      domParent.appendChild(fiber.dom);
      break;

    case "UPDATE":
      if (!fiber.alternate) {
        throw new Error("fiber must have alternate for update!")
      }
      updateDom(fiber.dom, fiber.alternate.props, fiber.props)
      break;

    case "DELETION":
      domParent.removeChild(fiber.dom);
      break;

    default:
      unreachable(fiber.effectTag)
  }

  // [debug hook] No-op unless a debug tool (src/debug-overlay.js) is loaded.
  globalThis.__didactCommit?.(fiber);

  if (fiber.child) {
    commitWork(fiber.child);
  }

  if (fiber.sibling) {
    commitWork(fiber.sibling);
  }
}

const isEvent = (key: string) => key.startsWith("on");
const isProperty = (key: string) => key !== "children" && !isEvent(key);
const eventNameFromHandlerName = (name: string) => name.toLowerCase().substring(2);

function updateDom(node: HTMLElement | Text, prevProps: Props, nextProps: Props) {
  const isNew = (key: string) => prevProps[key] !== nextProps[key];
  const isGone = (key: string) => !(key in nextProps);

  if (node instanceof HTMLElement) {
    Object.keys(prevProps)
      .filter(isEvent)
      .filter(key => isGone(key) || isNew(key))
      .forEach(name => {
        const eventType = eventNameFromHandlerName(name);
        node.removeEventListener(eventType, prevProps[name]);
      })

    Object.keys(nextProps)
      .filter(isEvent)
      .filter(isNew)
      .forEach(name => {
        const eventType = eventNameFromHandlerName(name);
        node.addEventListener(eventType, nextProps[name]);
      })
  }

  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone)
    .forEach(name => {
      setDOMProperty(node, name, null);
    })

  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew)
    .forEach(name => {
      setDOMProperty(node, name, nextProps);
    })
}

function commitRoot() {
  if (!wipRoot) {
    return;
  }
  deletions.forEach(commitWork);
  if (wipRoot.child) {
    commitWork(wipRoot.child);
  }
  currentRoot = wipRoot;
  wipRoot = null;
}

function workLoop() {
  let shouldYield = false;
  let unitsOfWorkDoneThisChunk = 0;
  while (nextUnitOfWork && !shouldYield) {
    unitsOfWorkDoneThisChunk += 1;
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = unitsOfWorkDoneThisChunk >= config.unitOfWorkChunkSize;
  }
  if (!nextUnitOfWork) {
    commitRoot();
  }
  setTimeout(workLoop, config.msBetweenChunks);
}

function reconcileChildren(wipFiber: Fiber, elements: Element[]) {
  let index = 0;
  let oldFiber = wipFiber.alternate?.child ?? null;
  let prevSibling: Fiber|null = null;

  while (index < elements.length || oldFiber != null) {
    const element: Element | null = index < elements.length ? elements[index] : null;
    let newFiber: Fiber | null = null;

    let isSameType = false;

    if (oldFiber) {
      if (element?.type === oldFiber.type) {
        isSameType = true;
        newFiber = {
          type: element.type,
          props: element.props,
          dom: oldFiber.dom,
          parent: wipFiber,
          child: null,
          sibling: null,
          alternate: oldFiber,
          effectTag: "UPDATE"
        };
      }
    }

    if (element && !isSameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        child: null,
        sibling: null,
        alternate: null,
        effectTag: "PLACEMENT"
      }
    }

    if (oldFiber && !isSameType) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else {
      if (!prevSibling) {
        throw new Error("prevSibling must be defined")
      }
      // The tutorial's code had a check for 'element' guariding this setter,
      // but I don't *think* we need it so I'm leaving it out.
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

function performUnitOfWork(fiber: Fiber): Fiber | null {
  // [viz hook] No-op unless the visualizer (src/instrument.js) is loaded.
  // Safe to delete — nothing in Didact depends on it.
  globalThis.__didactTrace?.(fiber);

  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  reconcileChildren(fiber, fiber.props.children);

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
  setConfig
};

export default Didact;
