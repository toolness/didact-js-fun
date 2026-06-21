import { defineConfig } from "vite";

// The whole twist of this project lives here.
//
// Vite uses esbuild to transpile .jsx files. By default JSX like
//   <h1>hi</h1>
// becomes React.createElement("h1", null, "hi").
//
// We override the "JSX factory" so the SAME JSX instead becomes
//   Didact.createElement("h1", null, "hi")
// and fragments (<>...</>) become Didact.Fragment.
//
// That means every .jsx file just needs `Didact` in scope — we import it
// explicitly at the top of each JSX module (see src/main.jsx) so the
// mapping from JSX -> our own library is visible and obvious.
export default defineConfig({
  esbuild: {
    jsxFactory: "Didact.createElement",
    jsxFragment: "Didact.Fragment",
  },
});
