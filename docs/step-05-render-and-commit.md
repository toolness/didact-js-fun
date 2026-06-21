# Step V — Render and Commit Phases

> A linear rewrite of [Step V of "Build your own React"](https://pomb.us/build-your-own-react/),
> continuing from `docs/step-04-fibers.md`. Same deal: one flow of text with
> code in between, matching the naming in our `src/didact.js`.

## Where we are, and the flaw we left in

At the end of Step IV we could render in small, interruptible chunks. But we
introduced a flaw. Look at the middle of `performUnitOfWork`:

```javascript
if (fiber.parent) {
  fiber.parent.dom.appendChild(fiber.dom);
}
```

We mutate the **real DOM** on every single unit of work. Since the browser can
interrupt us between any two units, the user can catch the page **mid-build** —
some nodes added, the rest missing. We made rendering pausable, but at the cost
of showing half-finished UI.

> If you've got the slow-motion work loop and the fiber visualizer running, this
> is exactly what you've been watching: text and elements dribbling into the App
> Output pane one at a time. That dribble is the bug.

The fix is a clean separation of concerns:

- **Render phase** — walk the fibers and build the whole tree *in memory*,
  touching nothing in the DOM. This is the part that can be paused and resumed.
- **Commit phase** — once the entire tree is built, apply it to the DOM in one
  shot. This part runs start-to-finish without interruption.

That way the user never sees a partial tree: either the old DOM, or the
complete new one.

## Stop mutating the DOM during render

First, delete those lines from `performUnitOfWork`. It should no longer append
anything — it only creates the DOM node (held on the fiber, not attached to the
document) and wires up child fibers:

```javascript
function performUnitOfWork(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  // (the appendChild block that used to live here is gone)

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
```

Each fiber now carries a detached DOM node in `fiber.dom`. The tree of fibers is
a complete description of what we *want* the DOM to look like — but the document
itself is untouched until we commit.

## Keep a handle on the root: `wipRoot`

To commit the whole tree at the end, we need to find it again once the render
walk is done. So we keep a reference to the root of the **w**ork-**i**n-
**p**rogress tree — `wipRoot`. `render` now sets up that root and points
`nextUnitOfWork` at it:

```javascript
let nextUnitOfWork = null;
let wipRoot = null;

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
  };
  nextUnitOfWork = wipRoot;
}
```

`nextUnitOfWork` is still our "where am I in the walk" cursor; `wipRoot` is the
fixed handle on the top of the tree so we don't lose it as the cursor moves.

## Detect "render finished," then commit

In the work loop, the render phase is done when there's no more work
(`nextUnitOfWork` is `null`) but we still have a tree waiting to be committed
(`wipRoot` is set). That's the moment to commit:

```javascript
function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  // Render phase is over (no work left) and we have a built tree → commit it.
  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);
```

> If you're using the slow-motion `setTimeout` work loop from the visualization
> experiment, the change is identical — just drop the same `if (!nextUnitOfWork
> && wipRoot) commitRoot();` block in right before your `setTimeout(workLoop,
> …)` line.

## The commit phase

Committing means walking the finished fiber tree and appending every node to its
parent's DOM node. We start at the root's child (the root's own `dom` is the
container, which is already in the document) and recurse through `child` and
`sibling`:

```javascript
function commitRoot() {
  commitWork(wipRoot.child);
  wipRoot = null;
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }
  const domParent = fiber.parent.dom;
  domParent.appendChild(fiber.dom);
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}
```

Two things to notice:

- This recursion is **plain and synchronous** — and that's fine. The commit
  phase is *meant* to run to completion without yielding, so the user only ever
  sees the finished result. We deliberately gave up interruptibility here; it's
  the render phase that needed to be pausable, not this.
- We set `wipRoot = null` at the end so the `if (!nextUnitOfWork && wipRoot)`
  guard doesn't fire again on the next idle tick and re-commit the same tree.

## What you'll see (and how the visualizer proves it)

Behaviorally: the page now stays on the *old* content (here, blank) for the
entire render phase, then the *whole* new tree appears at once when commit runs.
No more dribble.

This is the perfect moment to lean on the slow-motion setup:

- The **fiber graph** still grows node-by-node, one every 250ms — because that's
  the render phase, and it's exactly as interruptible as before.
- The **App Output** pane now stays empty the whole time the graph is
  building… and then snaps to the complete UI in a single frame when
  `commitRoot` fires.

Watching those two panes diverge — graph crawling, output blank, then output
popping in all at once — *is* the render/commit split made visible. Compare it
to Step IV, where the output filled in node-by-node alongside the graph.

## The full file at the end of Step V

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

function createDom(fiber) {
  const dom =
    fiber.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  const isProperty = (key) => key !== "children";
  Object.keys(fiber.props)
    .filter(isProperty)
    .forEach((name) => {
      dom[name] = fiber.props[name];
    });

  return dom;
}

function commitRoot() {
  commitWork(wipRoot.child);
  wipRoot = null;
}

function commitWork(fiber) {
  if (!fiber) {
    return;
  }
  const domParent = fiber.parent.dom;
  domParent.appendChild(fiber.dom);
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

let nextUnitOfWork = null;
let wipRoot = null;

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
  };
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

const Didact = { createElement, render };
export default Didact;
```

## Where this is heading

We can now build a tree off-screen and commit it atomically. But we still throw
the whole tree away and rebuild from scratch every render, and we can only ever
*add* nodes — there's no notion of updating or removing. That's **Step VI:
Reconciliation**, where `wipRoot` gains an `alternate` link back to the last
committed tree (`currentRoot`), and we start diffing old fibers against new
elements to decide what to add, update, or delete. The clean render/commit
split you just built is the groundwork that makes that diffing possible.
