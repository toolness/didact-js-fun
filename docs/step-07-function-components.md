# Step VII — Function Components

> A linear rewrite of [Step VII of "Build your own React"](https://pomb.us/build-your-own-react/),
> continuing from `docs/step-06-reconciliation.md`. One flow of text with code
> in between — and since your `didact.js` is now `didact.ts`, the snippets are
> TypeScript and assume your `Fiber`/`Element`/`Props` types.

## Where we are, and the assumption that's about to break

Everything so far has quietly assumed **one fiber ↔ one DOM node**. You can see
it all over the code:

- `performUnitOfWork` does `if (!fiber.dom) fiber.dom = createDom(fiber)` for
  every fiber.
- `commitWork` reads `fiber.parent.dom` and expects it to be there (your version
  even throws if it isn't).

Function components break both halves of that assumption:

```jsx
function App(props) {
  return <h1>Hi {props.name}</h1>;
}

const element = <App name="Didact" />;
```

`<App name="Didact" />` compiles to `Didact.createElement(App, { name: "Didact" })`
— so the element's `type` is **a function**, not a string tag. Two consequences:

1. **A function component has no DOM node of its own.** `App` doesn't *become* an
   element; it *returns* one. So its fiber's `dom` stays `null`.
2. **Its children come from calling it**, not from `fiber.props.children`. You get
   them by running `fiber.type(fiber.props)`.

So Step VII is really two edits: branch `performUnitOfWork` on whether the fiber
is a function, and teach the commit phase to cope with fibers that have no DOM
node.

## Branching the work

Split `performUnitOfWork` into two paths. The host (DOM-element) path is exactly
what you have today; the function path is new:

```typescript
function performUnitOfWork(fiber: Fiber): Fiber | null {
  globalThis.__didactTrace?.(fiber); // [viz hook]

  if (typeof fiber.type === "function") {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // returning the next unit of work is unchanged: child → sibling → uncle
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber: Fiber | null = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
  return null;
}

function updateHostComponent(fiber: Fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

function updateFunctionComponent(fiber: Fiber) {
  const fn = fiber.type as FunctionComponent;
  const children = [fn(fiber.props)];
  reconcileChildren(fiber, children);
}
```

`updateFunctionComponent` never touches the DOM — it just runs the function to
get one child element and reconciles. Note it leaves `fiber.dom` as `null`. That
`null` is the thing the commit phase now has to handle.

## The hard part: committing with DOM-less fibers

Two places in `commitWork` assumed a DOM node existed. Both need to change.

**1. Finding the parent DOM node.** A child of a function component can't just
use `fiber.parent.dom` — the parent *is* the function component, which has no
DOM. So walk **up** the fiber tree until you hit an ancestor that actually has
one:

```typescript
let domParentFiber = fiber.parent;
while (domParentFiber && !domParentFiber.dom) {
  domParentFiber = domParentFiber.parent;
}
const domParent = domParentFiber?.dom;
```

This replaces your current `if (!fiber.parent?.dom) throw …` — the parent
chain might legitimately skip several DOM-less fibers before reaching a real
node.

**2. Placement/update must skip DOM-less fibers.** A function-component fiber has
nothing to append or update, so guard those branches on `fiber.dom`. Your
top-of-function `if (!fiber.dom) throw …` has to go — `null` is now valid.

**3. Deletion must walk *down*.** When you delete a function component, there's
no `fiber.dom` to `removeChild`. The node to remove lives one or more levels
*below* it. So deletion gets its own helper that descends to the first fiber
with a DOM node:

```typescript
function commitDeletion(fiber: Fiber, domParent: HTMLElement | Text) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else if (fiber.child) {
    commitDeletion(fiber.child, domParent);
  }
}
```

Putting it together in your switch-based `commitWork`:

```typescript
function commitWork(fiber: Fiber) {
  if (!fiber.effectTag) {
    throw new Error("fiber must have an effect tag");
  }

  // Walk up past any DOM-less (function-component) ancestors.
  let domParentFiber = fiber.parent;
  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  if (!domParentFiber?.dom) {
    throw new Error("no DOM-bearing ancestor found");
  }
  const domParent = domParentFiber.dom;

  switch (fiber.effectTag) {
    case "PLACEMENT":
      if (fiber.dom) domParent.appendChild(fiber.dom); // dom-less fn fibers: nothing to place
      break;

    case "UPDATE":
      if (fiber.dom) {
        if (!fiber.alternate) throw new Error("fiber must have alternate for update!");
        updateDom(fiber.dom, fiber.alternate.props, fiber.props);
      }
      break;

    case "DELETION":
      commitDeletion(fiber, domParent);
      break;

    default:
      unreachable(fiber.effectTag);
  }

  if (fiber.child) commitWork(fiber.child);
  if (fiber.sibling) commitWork(fiber.sibling);
}
```

> **Note for your code specifically:** you currently throw at the very top of
> `commitWork` with `if (!fiber.dom) throw …`. Delete that line — it will fire on
> every function-component fiber otherwise. The `fiber.dom` guards inside the
> `PLACEMENT`/`UPDATE` cases now do the right thing instead.

## The TypeScript angle (this is where it gets interesting for you)

Your types currently say a fiber/element `type` is a string-ish thing:

```typescript
export type ElementType = keyof HTMLElementTagNameMap | typeof TEXT_ELEMENT;
```

A function component's `type` is a *function*, so widen it:

```typescript
type FunctionComponent = (props: Props) => Element;

export type ElementType =
  | keyof HTMLElementTagNameMap
  | typeof TEXT_ELEMENT
  | FunctionComponent;
```

That one change ripples out, and the ripples are instructive:

- **`performUnitOfWork`**: `typeof fiber.type === "function"` is exactly the type
  guard TS needs — inside that branch, `fiber.type` narrows to
  `FunctionComponent`, so `fiber.type(fiber.props)` type-checks. (I still cast in
  the snippet above to be explicit, but the `typeof` guard alone narrows it.)
- **`createDom`**: it's only ever called for host components, but TS doesn't know
  that. After your `TEXT_ELEMENT` and `null` checks, `fiber.type` is still
  `keyof HTMLElementTagNameMap | FunctionComponent`. Add a guard so the remaining
  type is a real tag name:
  ```typescript
  if (typeof fiber.type === "function") {
    throw new Error("createDom called on a function component");
  }
  ```
  Now `document.createElement(fiber.type)` is happy.
- **`createElement`**: its first param is currently `type: string`. Widen it to
  `ElementType` so `createElement(App, …)` type-checks.

You won't need to touch JSX typing for this — `main.jsx` is still untyped JS, so
`<App name="…" />` just works at runtime via the factory. All the type work lives
in `didact.ts`, which is the point.

## See it work

In `main.jsx`, wrap your markup in a component and render it:

```jsx
function App(props) {
  return (
    <div id="app">
      <h1>Hello {props.name} 👋</h1>
      <p>Rendered by a function component.</p>
    </div>
  );
}

const container = document.getElementById("root");
Didact.render(<App name="Didact" />, container);
```

What to look for:

- It renders identically to the inline version — but there's now an extra fiber
  in the tree (the `App` fiber) that produces **no** DOM node.
- In your **visualizer**, that `App` fiber shows up as a node, but **hovering it
  highlights nothing** in the App Output pane — because `fiber.dom` is `null`.
  That empty highlight is a perfect, literal illustration of "a function
  component has no DOM node of its own." (Heads-up: the viz's `labelFor` will
  `String(fiber.type)` a function into its whole source text — you may want to
  special-case functions to show `fiber.type.name` instead. Purely cosmetic, and
  visualizer-side only.)

## Where this is heading

Function components are also the thing that makes **state** possible — because
they *run* on every render, you can hang per-component state off the fiber and
hand it back each time the function executes. That's **Step VIII: Hooks
(`useState`)**. The setup it needs starts right here in
`updateFunctionComponent`: before calling `fiber.type(fiber.props)`, you'll
stash the current fiber and reset a hook index —

```typescript
let wipFiber: Fiber | null = null;
let hookIndex = 0;
// inside updateFunctionComponent, before running the function:
wipFiber = fiber;
hookIndex = 0;
wipFiber.hooks = [];
```

— so that `useState`, called *inside* the function, knows which fiber and which
hook slot it belongs to. (You'll add a `hooks` field to your `Fiber` type then.)
That's the finale.
