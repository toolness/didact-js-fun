/// <reference types="vite/client" />

// JSX type shim — forces every JSX tag and expression to `any` for now, so the
// project type-checks before you've written any real types. This is the
// "everything is any" baseline: tighten it as you go.
//
// When you're ready to type Didact for real, a natural progression is:
//   1. `git mv src/didact.js src/didact.ts` (and update main's import to
//      `"./didact"` — extensionless — so it resolves the .ts file).
//   2. Add your `DidactElement` / `Fiber` interfaces in didact.ts.
//   3. Replace `JSX.Element` below with your element type, and give
//      `IntrinsicElements` real per-tag props if you want stricter JSX.
//   4. `npm run typecheck` to see what lights up.
declare namespace JSX {
  type Element = any;
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}
