# didact-js-fun

Working through Rodrigo Pombo's [**Build your own React**](https://pomb.us/build-your-own-react/) — writing my own React, called **Didact**.

The twist: JSX in this repo does **not** compile to `React.createElement`. It compiles to **`Didact.createElement`** — my own library in [`src/didact.js`](src/didact.js).

## Run it

```bash
npm install
npm run dev
```

## How the JSX → Didact wiring works

Vite's esbuild transpiler is told to use a custom JSX factory in [`vite.config.js`](vite.config.js):

```js
esbuild: {
  jsxFactory: "Didact.createElement",
  jsxFragment: "Didact.Fragment",
}
```

So this JSX:

```jsx
<h1 id="x">hi</h1>
```

becomes:

```js
Didact.createElement("h1", { id: "x" }, "hi")
```

Each `.jsx` file just needs `Didact` in scope — we `import Didact from "./didact.js"` at the top (see [`src/main.jsx`](src/main.jsx)).

## The roadmap (from the tutorial)

`src/didact.js` is an empty skeleton — you write all of it. The only fixed
contract is that the default export has `createElement`, `render`, and
`Fragment` keys (that's what the JSX wiring + `main.jsx` expect).

- [ ] Step I — `createElement`
- [ ] Step II — `render`
- [ ] Step III — Concurrent Mode (`workLoop` + `requestIdleCallback`)
- [ ] Step IV — Fibers
- [ ] Step V — Render and Commit phases
- [ ] Step VI — Reconciliation
- [ ] Step VII — Function Components
- [ ] Step VIII — Hooks (`useState`)
