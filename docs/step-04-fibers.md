# Step IV — Fibers

> A linear rewrite of [Step IV of "Build your own React"](https://pomb.us/build-your-own-react/),
> as one flow of text with code in between. Matches the naming in our
> `src/didact.js` (e.g. the `TEXT_ELEMENT` constant).

## Where we are

At the end of Step II we had a `render` that walked the element tree with a
plain recursive function:

```javascript
function render(element, container) {
  const dom =
    element.type === TEXT_ELEMENT
      ? document.createTextNode("")
      : document.createElement(element.type);

  const isProperty = (key) => key !== "children";
  Object.keys(element.props)
    .filter(isProperty)
    .forEach((name) => {
      dom[name] = element.props[name];
    });

  element.props.children.forEach((child) => render(child, dom));

  container.appendChild(dom);
}
```

There's a problem hiding in that last `forEach`: **recursion can't be paused.**
Once we start rendering, we keep going until we've walked the entire tree. If
the tree is big, we hog the main thread — the browser can't handle input or
paint a frame until we're completely done. The whole render is one
indivisible, synchronous blob of work.

We want to break that blob into small pieces, do one piece at a time, and let
the browser interrupt us between pieces if it has more important things to do
(like responding to a click). To do that, we need to stop relying on the call
stack to remember where we are in the tree — because we don't control the call
stack. We need our own data structure that we *can* pause and resume.

That data structure is the **fiber**.

## The idea: one fiber per element

We'll create one fiber for every element. A fiber is just a plain object, and
the trick is how the fibers point at each other. Each fiber holds three links:

- `child` — its first child
- `sibling` — its next sibling
- `parent` — back up to its parent

(it also carries `type`, `props`, and a `dom` reference, but the three links
are what make traversal work).

Say we render this tree:

```javascript
Didact.render(
  <div>
    <h1>
      <p />
      <a />
    </h1>
    <h2 />
  </div>,
  container
)
```

The fibers link up like this:

```
        root
         │ child
         ▼
        div
         │ child
         ▼
        h1 ──────sibling──────► h2
         │ child                 │
         ▼                       ▼(parent → div)
         p ───sibling───► a
```

Every arrow downward is a `child`, every arrow rightward is a `sibling`, and
every node also keeps a `parent` pointer going back up (not all drawn, to keep
the picture clean).

## The traversal rule

Here's why those three links are exactly what we need. When we finish the work
for one fiber, we need to find the next fiber to work on. We follow a simple,
fixed rule:

1. If the fiber has a **child**, that's next.
2. Otherwise, if it has a **sibling**, that's next.
3. Otherwise, go up to the **parent** and look for *its* sibling ("the uncle").
   Keep walking up until we find a fiber that has a sibling, or we reach the
   root (in which case we're done).

For the tree above, that visits: `div`, `h1`, `p`, `a`, `h2`, and then unwinds
to the root. It's a depth-first walk — exactly what the recursive version did —
but now *we* drive it one step at a time instead of the call stack driving it
all at once.

> This is the heart of the whole step: `child`/`sibling`/`parent` are the
> explicit version of what recursion was tracking implicitly. "Go to the child"
> is descending into a call; "go to the sibling" is the next iteration of the
> children loop; "go up to the parent" is a function returning.

## Pulling DOM creation into its own function

Before we rewrite `render`, let's extract the node-creation logic from the old
`render` into a helper, because we'll now call it from a different place. It's
the same code as before, just relocated and taking a `fiber` instead of an
`element`:

```javascript
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
```

## Rewriting `render` to just kick things off

`render` no longer does the walking. Its only job now is to set up the **first**
unit of work — the root fiber — and stash it in a module-level variable. The
root fiber's `dom` is the container the user passed in, and its single child is
the element we want to render.

```javascript
let nextUnitOfWork = null;

function render(element, container) {
  nextUnitOfWork = {
    dom: container,
    props: {
      children: [element],
    },
  };
}
```

Notice `render` does almost nothing now — it doesn't touch the DOM, it just
points `nextUnitOfWork` at the root. The actual work happens in the loop.

## The work loop

Now the engine. We want to process one unit of work, then check whether the
browser needs the thread back, and if so, yield and continue later. The browser
gives us exactly the right hook for this: `requestIdleCallback`. It calls us
when the main thread is idle and hands us a `deadline` telling us how much time
we have before it needs control back.

```javascript
function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);
```

Read that loop carefully:

- As long as there's a `nextUnitOfWork` and we shouldn't yield, do one unit.
  `performUnitOfWork` returns the *next* unit, which we assign back to
  `nextUnitOfWork`.
- After each unit, ask the deadline how much time is left. If there's less than
  a millisecond, set `shouldYield = true` and fall out of the loop.
- Either way, we call `requestIdleCallback(workLoop)` again to be resumed on the
  next idle period. If we yielded mid-tree, `nextUnitOfWork` still points at
  where we stopped, so we pick right back up.

> `requestIdleCallback` is a real browser API, but React doesn't actually use it
> anymore — it ships its own scheduler. Conceptually it's the same thing:
> "here's a deadline, do some work, give the thread back when you're out of
> time." For learning, `requestIdleCallback` is perfect.

## Performing one unit of work

This is where a single fiber gets processed. `performUnitOfWork` does three
things: create the DOM node, create the child fibers, and return the next unit
of work.

```javascript
function performUnitOfWork(fiber) {
  // 1. Create this fiber's DOM node if it doesn't have one yet,
  //    and attach it to its parent's DOM node.
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  if (fiber.parent) {
    fiber.parent.dom.appendChild(fiber.dom);
  }

  // 2. Create a fiber for each child, wiring up child/sibling/parent links.
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

    // The first child is reached via the parent's `child` link.
    // Every child after that is reached via the previous child's `sibling`.
    if (index === 0) {
      fiber.child = newFiber;
    } else {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }

  // 3. Return the next unit of work, following the traversal rule:
  //    child first...
  if (fiber.child) {
    return fiber.child;
  }
  //    ...then sibling, walking up to find an "uncle" if needed.
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}
```

Walk through the three blocks:

- **Block 1** lazily creates the DOM node (the root already has one — the
  container — which is why we guard with `if (!fiber.dom)`), then appends it
  under its parent's DOM node.
- **Block 2** is the `child`/`sibling` wiring from earlier, written out as a
  loop. The first child becomes `fiber.child`; each later child becomes the
  previous child's `sibling`; all of them point back to `fiber` as `parent`.
- **Block 3** is the traversal rule verbatim: child, else sibling, else climb
  parents looking for a sibling. Whatever it returns becomes the next
  `nextUnitOfWork` back in `workLoop`.

## What we've gained (and a flaw we've introduced)

We can now render in interruptible chunks. The browser can slip in between any
two units of work to handle input or paint. That was the whole goal.

But notice **block 1 mutates the real DOM** (`appendChild`) on every single
unit. That means if the browser interrupts us partway through, the user can see
a **half-finished tree** — some nodes added, the rest not there yet. We traded
"blocks the thread" for "shows incomplete UI."

That's the exact problem Step V fixes: we'll stop touching the DOM during this
walk, build the whole fiber tree off to the side first, and then commit it to
the DOM all at once. The fiber structure we just built is precisely what makes
that possible — because the in-progress tree lives in our own objects, not in
the live document.

## The full file at the end of Step IV

For reference, here's everything together (the `createElement` /
`createTextElement` from earlier steps are unchanged and shown for context):

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

let nextUnitOfWork = null;

function render(element, container) {
  nextUnitOfWork = {
    dom: container,
    props: {
      children: [element],
    },
  };
}

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function performUnitOfWork(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  if (fiber.parent) {
    fiber.parent.dom.appendChild(fiber.dom);
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

> One gotcha when you wire this into our project: `render` no longer calls
> anything synchronously — it just sets `nextUnitOfWork`. The `workLoop` /
> `requestIdleCallback` lines run at module load and keep polling, so by the
> time you call `Didact.render(...)` the loop is already spinning, waiting for
> work. Don't put `requestIdleCallback(workLoop)` *inside* `render`.
