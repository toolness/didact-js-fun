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

type Hook<T> = {
  state: T,
  queue: Array<(prev: T) => T>,
};

type Fiber = {
  type: ElementType | null,
  parent: Fiber | null,
  child: Fiber | null,
  sibling: Fiber | null,
  alternate: Fiber | null,
  effectTag: EffectTag | null,
  props: Props,
  dom: HTMLElement | Text | null
  hooks: Hook<any>[]
}

type EffectTag = "UPDATE" | "PLACEMENT" | "DELETION";

export type FunctionComponent = (props: Props) => Element;

export type HostComponentType = keyof HTMLElementTagNameMap | typeof TEXT_ELEMENT

export type ElementType = HostComponentType | FunctionComponent

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
  // Make this small enough to be fast, but big enough that it's easy
  // for the rendering to fall behind user actions.
  msBetweenChunks: 10
}

let config: Config = DEFAULT_CONFIG;

let nextUnitOfWork: Fiber|null = null;

let wipRoot: Fiber | null = null;

let currentRoot: Fiber | null = null;

let deletions: Fiber[] = [];

let isInitialized = false;

let wipFiber: Fiber | null = null;

let hookIndex = 0;

function setConfig(newConfig: Config) {
  config = newConfig;
}

function useState<T>(initial: T): [T, (action: (prev: T) => T) => void] {
  if (!wipFiber) {
    throw new Error("useState must be called inside a function component");
  }

  const oldHook: Hook<T> | undefined = wipFiber.alternate?.hooks?.[hookIndex];

  const hook: Hook<T> = {
    state: oldHook ? oldHook.state : initial,
    queue: []
  }

  // This is pretty important: due to all kinds of other sources of
  // re-rendering, which aborts the current render, as well as other potential
  // busy-work on the main thread, our last actual hook state may be woefully
  // out of date. For example, the user may have clicked an "increment counter"
  // button 2 times since our last full render.
  // 
  // What's currently mounted to the DOM refers to its state, meaning that every
  // time the user clicked that button, it queued an action on the *old* hook's
  // queue. We're going to process all those now to make sure our new hook state
  // is up-to-date.
  const actions = oldHook ? oldHook.queue : [];
  actions.forEach(action => {
    hook.state = action(hook.state);
  });

  // TODO: It'd be nice if this had a stable identity like React's setState
  // does, but that seems to be outside the scope of the tutorial.
  const setState = (action: (prev: T) => T) => {
    hook.queue.push(action);
    scheduleRerender();
  }

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

function createElement(type: ElementType, props: Omit<Props, "children">, ...children: Array<Element|string>) {
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

function createDom(fiber: Fiber, type: HostComponentType) {
  assertStrictEq(fiber.type, type);
  const dom =
    type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(type);
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

function scheduleRerender() {
  if (!currentRoot) {
    // TODO: Should we actually throw here? Seems like this
    // should never happen since this is an internal function
    // that is only called when we've committed at least once...
    return;
  }

  wipRoot = {
    type: null,
    parent: null,
    child: null,
    sibling: null,
    dom: currentRoot.dom,
    props: currentRoot.props,
    alternate: currentRoot,
    effectTag: null,
    hooks: []
  }
  // Note that this means we will effectively ABORT any in-progress render.
  nextUnitOfWork = wipRoot;
  deletions = [];
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
    effectTag: null,
    hooks: []
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

function assertStrictEq(a: unknown, b: unknown)  {
  if (a !== b) {
    throw new Error("Assertion failure, args are not equal");
  }
}

function commitDeletion(fiber: Fiber, domParent: HTMLElement | Text) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else if (fiber.child) {
    commitDeletion(fiber.child, domParent);
  } else {
    // We can relax this if/when we start supporting function components
    // that return null, etc, but right now we don't support them.
    throw new Error("fiber must have a descendant that is a DOM node");
  }
}

function commitWork(fiber: Fiber) {
  let domParentFiber = fiber.parent;

  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }

  if (!domParentFiber?.dom) {
    throw new Error("a fiber ancestor must have a dom node");
  }

  if (!fiber.effectTag) {
    throw new Error("fiber must have an effect tag");
  }

  const domParent = domParentFiber.dom;

  switch (fiber.effectTag) {
    case "PLACEMENT":
      // Note that fiber.dom will be null on function components.
      if (fiber.dom) {
        domParent.appendChild(fiber.dom);
      }
      break;

    case "UPDATE":
      if (!fiber.alternate) {
        throw new Error("fiber must have alternate for update!")
      }
      // Note that fiber.dom will be null on function components.
      if (fiber.dom) {
        updateDom(fiber.dom, fiber.alternate.props, fiber.props)
      }
      break;

    case "DELETION":
      commitDeletion(fiber, domParent);
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
          hooks: [],
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
        hooks: [],
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

function updateHostComponent(fiber: Fiber, type: HostComponentType) {
  assertStrictEq(fiber.type, type);
  if (!fiber.dom) {
    fiber.dom = createDom(fiber, type);
  }
  reconcileChildren(fiber, fiber.props.children);
}

function updateFunctionComponent(fiber: Fiber, component: FunctionComponent) {
  assertStrictEq(fiber.type, component);
  wipFiber = fiber;
  hookIndex = 0;
  assertStrictEq(wipFiber.hooks.length, 0);
  const children = [component(fiber.props)];
  reconcileChildren(fiber, children);
}

function performUnitOfWork(fiber: Fiber): Fiber | null {
  // [viz hook] No-op unless the visualizer (src/instrument.js) is loaded.
  // Safe to delete — nothing in Didact depends on it.
  globalThis.__didactTrace?.(fiber);

  if (typeof fiber.type === "function") {
    updateFunctionComponent(fiber, fiber.type);
  } else if (fiber.type === null) {
    // This is the root component.
    reconcileChildren(fiber, fiber.props.children);
  } else {
    updateHostComponent(fiber, fiber.type);
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

// TODO: This isn't actually supported yet.
const Fragment = "FRAGMENT";

const Didact = {
  createElement,
  render,
  Fragment,
  useState,
  setConfig
};

export default Didact;
