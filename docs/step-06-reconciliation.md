# Step VI — Reconciliation

> A linear rewrite of [Step VI of "Build your own React"](https://pomb.us/build-your-own-react/),
> continuing from `docs/step-05-render-and-commit.md`. One flow of text with
> code in between, matching the naming in our `src/didact.js`.

## Where we are, and what's missing

After Step V we can build a fiber tree off-screen and commit it to the DOM all
at once. But we can only ever **add** nodes. We have no way to **update** a node
whose props changed, or **remove** a node that's gone. Every call to `render`
also throws the entire previous tree away and builds a brand new one from
scratch.

Reconciliation fixes that. The idea: when we render again, instead of building
blindly, we **compare** the new elements against the fiber tree we committed
last time, and for each fiber decide whether to place it, update it, or delete
it. To do that comparison we need to keep the old tree around and give each new
fiber a link back to its old counterpart.

## First: make the work loop ambient

Before anything else, one structural change — because Step VI is the first time
we **re-render**. Up to now you may have kicked the loop off from inside
`render` (`render()` calls `workLoop()`). That was fine for a single render, but
reconciliation re-renders constantly (the demo below re-renders on every
keystroke). If `render` starts the loop each time, you end up with a *new*
self-rescheduling loop per render, all racing on the same globals.

So: `render` should only *set up the work*, and the loop should run on its own,
started **once**:

```javascript
function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }
  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop); // start it ONCE, at module load
```

> If you're running the slow-motion `setTimeout` variant for the visualizer, the
> same rule holds: keep the `setTimeout(workLoop, …)` self-reschedule, start it
> once at the bottom of the module, and **remove the `workLoop()` call from
> `render`**. One ambient loop, forever; `render` just feeds it.

## Remember the last committed tree

We add two module-level variables. `currentRoot` is the root of the fiber tree
we last committed to the DOM. `deletions` collects fibers we need to remove
(they won't be in the new tree, so we have to track them separately).

```javascript
let nextUnitOfWork = null;
let currentRoot = null;
let wipRoot = null;
let deletions = null;
```

Now `render` links the new work-in-progress root to the old tree via an
`alternate` pointer, and resets the deletions list:

```javascript
function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}
```

`alternate` is the whole trick: every work-in-progress fiber will carry a link
to "the fiber that was here last time." That's what we diff against.

## Diffing: `reconcileChildren`

In Step IV/V, `performUnitOfWork` created child fibers in an inline loop. We now
pull that loop out into `reconcileChildren` and teach it to diff. So
`performUnitOfWork` slims down to:

```javascript
function performUnitOfWork(fiber) {
  globalThis.__didactTrace?.(fiber); // [viz hook] — harmless if unused

  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  reconcileChildren(fiber, fiber.props.children);

  // return next unit of work: child, then sibling, then up to an "uncle"
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
```

And here's the diff itself. It walks the **new elements** and the **old fibers**
(`wipFiber.alternate.child` and its sibling chain) in parallel:

```javascript
function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber = null;

    const sameType = oldFiber && element && element.type === oldFiber.type;

    if (sameType) {
      // Same type → keep the DOM node, just update its props.
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      };
    }
    if (element && !sameType) {
      // New element, different (or no) old fiber → make a fresh DOM node.
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }
    if (oldFiber && !sameType) {
      // Old fiber with no matching new element → delete it.
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}
```

The three cases are the heart of it:

- **`sameType`** (old fiber and new element have the same `type`): reuse the
  existing DOM node (`dom: oldFiber.dom`), keep the link back via `alternate`,
  and tag it `"UPDATE"` — we'll reconcile its props at commit time.
- **new element, not same type**: a node that needs creating — fresh `dom: null`
  (so `performUnitOfWork` builds it), tagged `"PLACEMENT"`.
- **old fiber, not same type**: a node that should disappear — tag the *old*
  fiber `"DELETION"` and push it onto `deletions`.

> This is a deliberately simple diff: it compares by `type` and **position**
> only — it has no notion of `key`s, so reordering a list re-creates nodes
> instead of moving them. Real React uses `key` here. That's a known limitation
> the tutorial calls out and leaves as-is.

## Effect tags drive the commit

Now the commit phase reads those tags. `commitRoot` first applies all the
deletions, then walks the new tree; afterwards it records the committed tree as
`currentRoot` (so the *next* render has something to diff against):

```javascript
function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  const domParent = fiber.parent.dom;
  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    domParent.removeChild(fiber.dom);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}
```

> If you inlined `commitRoot` into `workLoop` back in Step V, just make sure that
> inlined block now also does `deletions.forEach(commitWork)` first and sets
> `currentRoot = wipRoot` before nulling it. And if your `commitWork` started at
> `wipRoot` (rather than `wipRoot.child`), it still works: the root has no
> `effectTag`, so none of the three branches fire for it and it simply recurses
> into its child.

## Reconciling props: `updateDom`

`PLACEMENT` and `DELETION` are easy (append / remove a node). `UPDATE` is the
interesting one: the DOM node stays, but its props may have changed. `updateDom`
diffs the old props against the new ones and applies just the differences —
including event listeners, which we now support (any prop starting with `on`).

First, four little predicate helpers:

```javascript
const isEvent = (key) => key.startsWith("on");
const isProperty = (key) => key !== "children" && !isEvent(key);
const isNew = (prev, next) => (key) => prev[key] !== next[key];
const isGone = (prev, next) => (key) => !(key in next);
```

Then the four passes — remove stale listeners, remove gone props, set new/changed
props, add new/changed listeners:

```javascript
function updateDom(dom, prevProps, nextProps) {
  // Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = "";
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}
```

Notice events: a prop like `onClick` becomes an `addEventListener("click", …)`.
That's why `isProperty` excludes `on*` keys — they're not DOM properties to
assign, they're listeners to register.

With `updateDom` in hand, we can **simplify `createDom`**. The old version had
its own prop-assigning loop; that's exactly "apply props, with no previous
props," so it's just `updateDom(dom, {}, fiber.props)`:

```javascript
function createDom(fiber) {
  const dom =
    fiber.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}
```

## See it work

The classic demo is a controlled input that re-renders on every keystroke:

```javascript
const container = document.getElementById("root");

const rerender = (value) => {
  const element = (
    <div>
      <input onInput={(e) => rerender(e.target.value)} value={value} />
      <h2>Hello {value}</h2>
    </div>
  );
  Didact.render(element, container);
};

rerender("World");
```

Two things prove reconciliation is working:

1. The `<input>` **keeps focus** as you type. Before reconciliation, every
   keystroke threw away the input DOM node and made a new one, blowing away the
   cursor. Now the `<input>` is `sameType` each render, so it's tagged `UPDATE`
   and the *same* node survives — only its `value` prop changes.
2. The `<h2>`'s text fiber is `UPDATE`d in place rather than re-created.

If you've got the fiber visualizer running, this is fun to watch: each keystroke
re-renders, the graph rebuilds, and you'll see the tree reconcile against the
previous one rather than the page flickering.

## The full file at the end of Step VI

```javascript
const TEXT_ELEMENT = "TEXT_ELEMENT";

function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      ),
    },
  };
}

function createTextElement(text) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

const isEvent = (key) => key.startsWith("on");
const isProperty = (key) => key !== "children" && !isEvent(key);
const isNew = (prev, next) => (key) => prev[key] !== next[key];
const isGone = (prev, next) => (key) => !(key in next);

function createDom(fiber) {
  const dom =
    fiber.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}

function updateDom(dom, prevProps, nextProps) {
  // Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = "";
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  const domParent = fiber.parent.dom;
  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    domParent.removeChild(fiber.dom);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

let nextUnitOfWork = null;
let currentRoot = null;
let wipRoot = null;
let deletions = null;

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }
  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function performUnitOfWork(fiber) {
  globalThis.__didactTrace?.(fiber); // [viz hook]

  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  reconcileChildren(fiber, fiber.props.children);

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

function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber = null;

    const sameType = oldFiber && element && element.type === oldFiber.type;

    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      };
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

const Didact = { createElement, render };
export default Didact;
```

## Where this is heading

Reconciliation assumed every fiber maps to a DOM node (we read `fiber.dom` and
`fiber.parent.dom` freely). That breaks for **function components**, whose fibers
produce *children* but no DOM node of their own — so `fiber.parent.dom` might be
two levels up, not one. That's **Step VII: Function Components**, where
`performUnitOfWork` branches on whether the fiber's `type` is a function, runs
it to get its children, and `commitWork` learns to walk up past DOM-less fibers
to find the real parent node. After that, **Step VIII** adds `useState` on top.
