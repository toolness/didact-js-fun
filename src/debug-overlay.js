// Commit-flash overlay — briefly highlights DOM nodes that Didact just
// committed: GREEN over nodes that were just ADDED (effectTag PLACEMENT), BLUE
// over nodes whose own props ACTUALLY CHANGED (effectTag UPDATE with a real
// diff). No-op UPDATEs (tag is UPDATE but nothing changed) flash nothing.
//
// It's like React DevTools' "highlight updates", drawn into the page itself.
//
// Driven entirely by the single `globalThis.__didactCommit(fiber)` hook that
// Didact's commitWork calls (the "[debug hook]" line). Everything else lives
// here — didact.ts stays clean. Delete the import in main.jsx to turn it off.

const isEvent = (key) => key.startsWith("on");
const isOwnProp = (key) => key !== "children" && !isEvent(key);

// Did this fiber's own props/handlers actually change vs. its previous fiber?
// Same comparison updateDom does — children are separate fibers, so ignore them.
function propsChanged(fiber) {
  const prev = fiber.alternate?.props ?? {};
  const next = fiber.props ?? {};
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!isOwnProp(key) && !isEvent(key)) continue;
    if (prev[key] !== next[key]) return true;
  }
  return false;
}

// Text nodes have no getBoundingClientRect — measure them with a Range so the
// box hugs the actual text.
function rectForDom(dom) {
  if (!dom) return null;
  if (dom.nodeType === Node.TEXT_NODE) {
    try {
      const range = document.createRange();
      range.selectNodeContents(dom);
      return range.getBoundingClientRect();
    } catch {
      return dom.parentNode?.getBoundingClientRect?.() ?? null;
    }
  }
  return dom.getBoundingClientRect();
}

function flash(dom, kind) {
  const rect = rectForDom(dom);
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  const box = document.createElement("div");
  box.className = `didact-flash didact-flash-${kind}`;
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  document.body.appendChild(box);
  box.addEventListener("animationend", () => box.remove());
  setTimeout(() => box.remove(), 1500); // safety net if animationend never fires
}

globalThis.__didactCommit = (fiber) => {
  // Function-component fibers (and the root) have no DOM node — nothing to flash.
  if (!fiber || !fiber.dom) return;
  if (fiber.effectTag === "PLACEMENT") {
    flash(fiber.dom, "placement");
  } else if (fiber.effectTag === "UPDATE" && propsChanged(fiber)) {
    flash(fiber.dom, "update");
  }
};
