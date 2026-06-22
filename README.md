This is my repo for working through Rodrigo Pombo's [**Build your own React**](https://pomb.us/build-your-own-react/).

Like Pombo's post, my React is called **Didact**.

As per the tutorial, JSX in this repo does **not** compile to `React.createElement`. It compiles to **`Didact.createElement`** — my own library in [`src/didact.js`](src/didact.js).

## Things to try

* Mouse over nodes in the fiber graph to see them highlighted in the render. Note that React components aren't highlighted: that's because their fibers don't actually have DOM nodes associated with them--they just return children.

* Click the "Increment" button and notice how updated elements have a blue overlay on them.

  (The text input is highlighted because it attaches an event listener whose identity changes every render--I didn't implement `useCallback`/`useMemo` so there's no way to leverage that.)

* Change the "ms / chunk" value to something big like 100. This effectively simulates what happens when React has a giant render tree and/or the host system is under a lot of load: the UI _is_ still responsive, but it might not be updated for a while.

  That said, note that it's possible to _starve_ the UI by constantly clicking "increment", and my understanding is that React won't allow that to happen: it eventually forces a commit to ensure the UI represents the user's actions accurately.

  This also reveals the helpfulness of `setState` taking a callback: the callback you pass might even be called _multiple_ times depending on whether React's fiber renderer throws away in-progress fiber graphs when re-renders are triggered.

## Methodology

* I wrote all of `src/didact.ts` myself, though a fair amount of it involved literally typing out code from Pombo's tutorial. While I normally prefer going back to first principles and re-deriving everything myself, I was limited by time. Nonetheless, typing every line out by hand did help me _understand_ what the code was doing.

* While I wrote the core library, I was inspired by Geoffrey Litt's [AI-generated tools can make programming more fun
](https://www.geoffreylitt.com/2024/12/22/making-programming-more-fun-with-an-ai-generated-debugger) and had Claude generate tooling for my library which, among other things, visualized the fiber tree, highlighted new/changed elements, and provided knobs for changing the engine's parameters.

* I also had Claude re-write parts of Pombo's tutorial because I found it difficult to understand. In particular, the code snippets involved sometimes-microscopic text flying into and out of the screen as I scrolled, which made it hard to correlate concepts with implementation. Claude's rewrites are in the `docs/` subdirectory.

## Quick start

```bash
npm install
npm run dev
```

## License

Everything in this repository is licensed under [CC0 1.0 Universal](./LICENSE.md) (public domain).

[LRC]: https://en.m.wikipedia.org/wiki/LRC_(file_format)
