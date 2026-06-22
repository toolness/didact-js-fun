// Makes hand-rolled Didact JSX type-check in .tsx files.
//
// With `jsx: "react"` + `jsxFactory: "Didact.createElement"` (see tsconfig.json),
// the TypeScript checker validates every JSX expression against the global `JSX`
// namespace below — independently of esbuild's runtime transform. We point its
// result type at Didact's own `Element`, so a JSX tree IS a `Didact.Element`,
// and Didact.render(<App/>, ...) type-checks against the real signature.
//
// Host-element attributes are intentionally loose (any extra attribute is
// allowed via the index signature), since Didact doesn't model the DOM prop
// surface. The handful of attributes/handlers the demo actually uses are typed
// precisely so event objects flow through without `any` or casts.

import type { Element as DidactElement } from "./didact";

// A DOM event whose `target` is narrowed to the element the handler sits on,
// so `e.target.value` and friends type-check without a cast.
type DidactEventHandler<E extends Event, T extends EventTarget> = (
  event: Omit<E, "target"> & { target: T },
) => void;

interface DidactIntrinsicProps {
  id?: string;
  value?: string;
  children?: unknown;
  onClick?: DidactEventHandler<MouseEvent, HTMLElement>;
  onInput?: DidactEventHandler<InputEvent, HTMLInputElement>;
  // Everything else Didact will happily pass through to the DOM node.
  [attribute: string]: unknown;
}

declare global {
  namespace JSX {
    // The type of any JSX expression: it's literally a Didact element.
    type Element = DidactElement;

    // Tells the checker that the `children` prop carries JSX children.
    interface ElementChildrenAttribute {
      children: {};
    }

    // Lowercase tags (<div>, <h1>, ...) are host components.
    interface IntrinsicElements {
      [tagName: string]: DidactIntrinsicProps;
    }
  }
}

export {};
