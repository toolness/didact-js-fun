# Step VIII — Hooks (`useState`)

> A linear rewrite of [Step VIII of "Build your own React"](https://pomb.us/build-your-own-react/),
> continuing from `docs/step-07-function-components.md`. One flow of text with
> code in between — TypeScript snippets that assume your `Fiber`/`Element`/`Props`
> types and the `updateFunctionComponent` you wrote last step.

## The whole idea in one sentence

A function component **runs again on every render** — so if you can stash some
data on the fiber, hand it back when the function runs, and *trigger a render*
when that data changes, you have state.

That's `useState`. Three moving parts:

1. **Storage**: a list of "hooks" hanging off each function-component fiber.
2. **Continuity**: on re-render, copy the previous fiber's hook values forward
   (the `alternate` link you already use for reconciliation).
3. **A render trigger**: `setState` schedules new work, and your already-running
   `workLoop` picks it up.

You set up the scaffolding for #1 at the very end of Step VII — `wipFiber` and
`hookIndex`. Now we use them.

## Wiring the fiber for hooks

Two module-level variables track *which* component is currently rendering and
*which* hook slot we're up to. Both get reset at the top of every function
component:

```typescript
let wipFiber: Fiber | null = null;
let hookIndex = 0;
```

Add a `hooks` field to your `Fiber` type. It's only ever populated for
function-component fibers, so it's optional:

```typescript
type Fiber = {
  type: ElementType | null,
  // ...everything you already have...
  hooks?: Hook<any>[],   // see the TypeScript angle below for why `any`
}
```

Then teach `updateFunctionComponent` to open a fresh hook list before it runs
the component. This is the *only* change to the function you wrote last step:

```typescript
function updateFunctionComponent(fiber: Fiber, component: FunctionComponent) {
  assertStrictEq(fiber.type, component);
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [component(fiber.props)];
  reconcileChildren(fiber, children);
}
```

Now, while `component(fiber.props)` runs, any `useState` call inside it can reach
the current fiber through `wipFiber` and claim the next slot via `hookIndex`.
That's the whole reason hooks must be called unconditionally and in the same
order every render — the *slot index* is the only thing tying a `useState` call
to its stored value. (This is "the rules of hooks", and now you can see exactly
why they exist: there's no name, just a counter.)

## `useState` itself

```typescript
type Hook<T> = {
  state: T,
  queue: Array<(prev: T) => T>,
};

function useState<T>(initial: T): [T, (action: (prev: T) => T) => void] {
  if (!wipFiber || !wipFiber.hooks) {
    throw new Error("useState must be called inside a function component");
  }

  // Same slot, previous render: this is where continuity comes from.
  const oldHook: Hook<T> | undefined = wipFiber.alternate?.hooks?.[hookIndex];

  const hook: Hook<T> = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  // Replay the updates that setState queued during the LAST render. Each is a
  // prev => next function, applied in order, so state ends up current.
  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action) => {
    hook.state = action(hook.state);
  });

  const setState = (action: (prev: T) => T) => {
    hook.queue.push(action);
    scheduleRerender();
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}
```

Read it top to bottom: find last render's hook at this slot → seed the new
hook's state from it (or the initial value on first render) → apply any actions
that were queued since → return the current state plus a `setState` that queues
*future* actions. The queued actions live on `hook.queue`, which becomes next
render's `oldHook.queue` — that's the hand-off.

Note `setState` takes an **updater function** (`prev => next`), not a bare value.
That keeps the example tiny; React accepts both. If you want both, widen the
parameter to `T | ((prev: T) => T)` and branch inside.

## The render trigger

`setState` has to kick off a new render from the **last committed tree**, not
from a fresh `render()` call. You build a `wipRoot` that reuses the current
root's DOM node and props, points its `alternate` at `currentRoot`, and aims
`nextUnitOfWork` at it:

```typescript
function scheduleRerender() {
  if (!currentRoot) return;
  wipRoot = {
    type: null,
    parent: null,
    child: null,
    sibling: null,
    dom: currentRoot.dom,
    props: currentRoot.props,
    alternate: currentRoot,
    effectTag: null,
  };
  nextUnitOfWork = wipRoot;
  deletions = [];
}
```

This is the same shape as the `wipRoot` your `render()` builds — in fact, it's
worth noticing how similar they are. `render()` seeds the root from a *new*
element; `scheduleRerender()` seeds it from `currentRoot`. You could factor a
shared helper, but they read clearly enough side by side.

**Here's the nice part about your specific code:** your `workLoop` already
reschedules itself unconditionally —

```typescript
setTimeout(workLoop, config.msBetweenChunks);  // runs even when idle
```

— so the loop is *always alive*, spinning on `nextUnitOfWork === null` doing
nothing (`commitRoot` early-returns when `wipRoot` is null). That means
`scheduleRerender` doesn't have to start anything. It just sets the three
work variables and the next idle tick picks them up. No `setTimeout`, no
"is the loop running?" check.

Finally, export it so components can import it:

```typescript
const Didact = {
  createElement,
  render,
  Fragment,
  setConfig,
  useState,
};
```

## The TypeScript angle (the honest bit)

The `hooks` array is the one place in this whole project where the type system
genuinely can't follow you, and it's worth being clear-eyed about why.

A single fiber's hooks are **heterogeneous**: slot 0 might be a
`Hook<number>`, slot 1 a `Hook<string>`. The thing that says "slot 0 is a
number" is the *call order at runtime* — a convention TS has no way to see. So
`hooks` can't be anything more precise than `Hook<any>[]` (or `Hook<unknown>[]`
if you want to force a check at each use site).

This is the same trade-off you faced with `assertStrictEq` in Step VII, and the
same resolution: **push the unsoundness to one tiny, named spot and keep the
edges honest.** Here that spot is the `any` inside `Hook<any>[]`. Everything
*around* it stays sound:

- `useState<T>` is generic, so each *call site* is fully typed —
  `useState(0)` gives you `[number, (a: (p: number) => number) => void]`.
- `oldHook: Hook<T> | undefined = wipFiber.alternate?.hooks?.[hookIndex]`
  assigns `Hook<any>` into `Hook<T>` with no cast — the `any` flows in
  silently, exactly at the boundary where the runtime convention takes over
  from the compiler.

So you get full type safety at every `useState` call, an `any` confined to the
storage array, and **no `as` anywhere** — consistent with the line you've held
since Step VII. (If you ever do the `RootFiber | HostComponentFiber |
FunctionComponentFiber` union we talked about, `hooks` naturally belongs only on
`FunctionComponentFiber`, which is a tidy bonus.)

One more: `wipFiber` is `Fiber | null`, so `useState` guards it and throws if
called outside a render. That throw is doing real work — it's the type-level
and runtime statement of "hooks only run inside components".

## See it work

In `main.tsx`, write a component that owns some state:

```tsx
function Counter() {
  const [count, setCount] = Didact.useState(0);
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount((c) => c + 1)}>Increment</button>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("no #root element");
Didact.render(<Counter />, container);
```

Click the button and watch the count climb — no `rerender(...)` plumbing in
sight. `setCount` queues an updater, `scheduleRerender` points the work loop at
a fresh root, and on the next pass `useState` replays the queue to produce the
new count.

What to look for in the **visualizer**:

- Each click is a full re-render — you'll see the tree repaint, with the
  `Counter` fiber (now labelled by name, after the Step VII viz tweak)
  producing no DOM node of its own, and the `“Count: N”` text node flipping to
  the **updated** (blue) effect color while its unchanged siblings stay no-op
  gray.
- The `Counter` fiber persists across renders by structural position — its
  hooks ride along on the `alternate` link, which is the exact mechanism you
  just implemented.

## Where this is heading

That's the finale of the core "Build your own React" walkthrough — you now have
`createElement`, render/commit phases, concurrent work via the loop,
reconciliation, function components, and state. From here the real React adds,
roughly:

- **More hooks** (`useEffect`, `useMemo`, `useRef`) — all the same fiber-slot
  trick, with effects deferred to run after commit.
- **Reconciliation by `key`** — so list reorders reuse the right fibers instead
  of matching purely by position.
- **Scheduling/priorities** — your fixed-size `workLoop` chunk is the toy
  version of React's lane-based scheduler (the very thing your config widgets
  let you poke at).

But the shape of all of it is already here in your `didact.ts`. Nice work.
