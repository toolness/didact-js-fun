// Fiber-graph visualizer. ENTIRELY separate from your Didact library — it just
// listens via the single `globalThis.__didactTrace(fiber)` hook that
// performUnitOfWork calls (the "[viz hook]" line in didact.js).
//
// Two features beyond a plain live graph:
//   1. A recorded "movie": every trace call snapshots the cumulative graph
//      state into frames[], and a scrubber / play button lets you replay and
//      rewind independently of the work loop's timing.
//   2. Siblings are ordered left-to-right in traversal order (see
//      reorderSiblingsLTR) so the tree grows rightward, the way the DOM does.
//
// You never need to edit this file to work through the tutorial.

import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

const cy = cytoscape({
  container: document.getElementById("fiber-graph"),
  userZoomingEnabled: false,
  userPanningEnabled: false,
  boxSelectionEnabled: false,
  autounselectify: true,
  style: [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "text-valign": "center",
        "text-halign": "center",
        "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "font-size": 12,
        color: "#fff",
        width: "label",
        height: 28,
        padding: 8,
        shape: "round-rectangle",
        "background-color": "#5b4bdb",
      },
    },
    { selector: "node.root", style: { "background-color": "#1a1a2e" } },
    { selector: "node.text", style: { "background-color": "#8b80e0", "font-style": "italic" } },
    {
      selector: "node.active",
      style: {
        "background-color": "#e0245e",
        "border-width": 4,
        "border-color": "#ffb3c8",
      },
    },
    { selector: "node.done", style: { opacity: 0.85 } },
    // Hidden = exists in the graph (so it keeps its laid-out position) but not
    // shown at the currently-scrubbed frame.
    { selector: ".hidden", style: { display: "none" } },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        width: 2,
        "target-arrow-shape": "triangle",
      },
    },
    {
      selector: "edge.child",
      style: { "line-color": "#5b4bdb", "target-arrow-color": "#5b4bdb" },
    },
    {
      selector: "edge.sibling",
      style: {
        "line-color": "#bbb",
        "target-arrow-color": "#bbb",
        "line-style": "dashed",
        "target-arrow-shape": "vee",
      },
    },
  ],
});

// --- DOM controls -----------------------------------------------------------

const scrubber = document.getElementById("graph-scrubber");
const playBtn = document.getElementById("graph-play");
const startBtn = document.getElementById("graph-start");
const frameLabel = document.getElementById("graph-frame");
const PLAYBACK_MS = 120;

// --- DOM-node highlight overlay ---------------------------------------------
// Hovering (or clicking to pin) a fiber node draws a box over the *real* DOM
// node it produced, in the App Output pane. The box is an absolutely-positioned
// overlay on top of the page — we never touch the highlighted node itself.

let pinnedId = null;

const highlight = document.createElement("div");
highlight.id = "dom-highlight";
document.body.appendChild(highlight);

// Get the on-screen rect of a fiber's DOM node. Text nodes have no
// getBoundingClientRect, so we measure them with a Range to hug the text.
function rectForDom(dom) {
  if (!dom) return null;
  if (dom.nodeType === Node.TEXT_NODE) {
    try {
      const range = document.createRange();
      range.selectNodeContents(dom);
      return range.getBoundingClientRect();
    } catch {
      return dom.parentNode ? dom.parentNode.getBoundingClientRect() : null;
    }
  }
  return dom.getBoundingClientRect();
}

function showHighlight(fiber) {
  const rect = fiber && rectForDom(fiber.dom);
  if (!rect) {
    hideHighlight();
    return;
  }
  highlight.style.display = "block";
  highlight.style.top = `${rect.top}px`;
  highlight.style.left = `${rect.left}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
}

function hideHighlight() {
  highlight.style.display = "none";
}

const graphEl = document.getElementById("fiber-graph");

cy.on("mouseover", "node", (evt) => {
  if (graphEl) graphEl.style.cursor = "pointer";
  if (!pinnedId) showHighlight(fiberById.get(evt.target.id()));
});
cy.on("mouseout", "node", () => {
  if (graphEl) graphEl.style.cursor = "";
  if (!pinnedId) hideHighlight();
});
// Click a node to pin its highlight (click again, or click empty space, to clear).
cy.on("tap", "node", (evt) => {
  const id = evt.target.id();
  if (pinnedId === id) {
    pinnedId = null;
    hideHighlight();
  } else {
    pinnedId = id;
    showHighlight(fiberById.get(id));
  }
});
cy.on("tap", (evt) => {
  if (evt.target === cy) {
    pinnedId = null;
    hideHighlight();
  }
});

// The overlay is position:fixed (viewport coords), so keep it aligned when
// anything scrolls or the window resizes; drop a transient (unpinned) box.
function realignHighlight() {
  if (pinnedId) showHighlight(fiberById.get(pinnedId));
  else hideHighlight();
}
window.addEventListener("scroll", realignHighlight, true); // capture: catch inner scrolls too
window.addEventListener("resize", realignHighlight);

// --- identity & bookkeeping -------------------------------------------------

const idForFiber = new WeakMap();
let nextId = 0;
function idFor(fiber) {
  let id = idForFiber.get(fiber);
  if (id === undefined) {
    id = "f" + nextId++;
    idForFiber.set(fiber, id);
  }
  return id;
}

let added = new Set(); // node ids already in the graph
let childrenByParent = new Map(); // parent id -> [child ids] in sibling order
let parentOf = new Map(); // child id -> parent id (so new nodes slide out of their parent)
let fiberById = new Map(); // node id -> fiber (to find its real DOM node on hover)
let lastActiveId = null;
let rootNodeId = null;
const ANIM_MS = 220;

// The recorded movie: one frame per trace call.
// Each frame = { present: string[] of element ids, active: node id }.
let frames = [];
let following = true; // while true, the scrubber tracks the live latest frame
let playTimer = null;

function labelFor(fiber) {
  if (!fiber.parent) return "root";
  if (fiber.type === "TEXT_ELEMENT") {
    const text = String(fiber.props.nodeValue ?? "").trim();
    const clipped = text.length > 16 ? text.slice(0, 15) + "…" : text;
    return `“${clipped}”`;
  }
  return String(fiber.type);
}

function kindClass(fiber) {
  if (!fiber.parent) return "root";
  if (fiber.type === "TEXT_ELEMENT") return "text";
  return "element";
}

function reset() {
  pause();
  cy.elements().remove();
  added = new Set();
  childrenByParent = new Map();
  parentOf = new Map();
  fiberById = new Map();
  pinnedId = null;
  hideHighlight();
  lastActiveId = null;
  rootNodeId = null;
  frames = [];
  following = true;
  scrubber.value = "0";
  scrubber.max = "0";
  updateLabel();
}

// --- layout -----------------------------------------------------------------

function subtreeNodes(id) {
  const out = [id];
  const kids = childrenByParent.get(id);
  if (kids) for (const c of kids) out.push(...subtreeNodes(c));
  return out;
}

// Parents in top-down (BFS) order, so when we re-pack a parent's children we've
// already placed that parent's whole subtree at the level above.
function parentsTopDown() {
  if (!rootNodeId) return [];
  const out = [];
  const queue = [rootNodeId];
  while (queue.length) {
    const id = queue.shift();
    if (childrenByParent.has(id)) {
      out.push(id);
      for (const c of childrenByParent.get(id)) queue.push(c);
    }
  }
  return out;
}

// dagre lays the tree out but doesn't preserve sibling order left-to-right
// (we exclude sibling edges, so it has no ordering info and tends to reverse).
// Fix it ourselves: for each parent, place its child subtrees side by side in
// sibling order, translating each whole subtree to keep its internal shape.
function reorderSiblingsLTR() {
  const GAP = 36;
  cy.batch(() => {
    // Pass 1, top-down: pack each parent's child subtrees side by side in
    // sibling order, translating each whole subtree to preserve its shape.
    for (const pid of parentsTopDown()) {
      const kids = childrenByParent.get(pid);
      if (!kids || kids.length < 2) continue;

      const info = kids.map((cid) => {
        const nodes = subtreeNodes(cid);
        let min = Infinity;
        let max = -Infinity;
        for (const n of nodes) {
          const x = cy.getElementById(n).position("x");
          if (x < min) min = x;
          if (x > max) max = x;
        }
        return { nodes, min, width: max - min };
      });

      let cursor = Math.min(...info.map((d) => d.min));
      for (const d of info) {
        const delta = cursor - d.min;
        if (delta !== 0) {
          for (const n of d.nodes) {
            const node = cy.getElementById(n);
            node.position("x", node.position("x") + delta);
          }
        }
        cursor += d.width + GAP;
      }
    }

    // Pass 2, bottom-up: center each parent over its immediate children (so a
    // single-child parent like root sits directly above its child).
    for (const pid of parentsTopDown().reverse()) {
      const kids = childrenByParent.get(pid);
      if (!kids || !kids.length) continue;
      let min = Infinity;
      let max = -Infinity;
      for (const cid of kids) {
        const x = cy.getElementById(cid).position("x");
        if (x < min) min = x;
        if (x > max) max = x;
      }
      cy.getElementById(pid).position("x", (min + max) / 2);
    }
  });
}

function relayout() {
  // Remember where everything currently sits (visually) before we recompute.
  const old = new Map();
  cy.nodes().forEach((n) => old.set(n.id(), { ...n.position() }));

  // Rank by the tree only (exclude sibling edges); animate off so we can
  // post-process positions synchronously...
  cy.elements()
    .not("edge.sibling")
    .layout({ name: "dagre", rankDir: "TB", nodeSep: 24, rankSep: 48, fit: false, animate: false })
    .run();
  reorderSiblingsLTR();

  // The model now sits at the freshly-computed target positions. Frame that
  // final layout first, so the viewport is stable while nodes glide in.
  cy.fit(undefined, 28);

  // Then animate each node from its old spot to the new one (NOT inside
  // cy.batch — batched position writes wouldn't be flushed before animate()
  // samples the "from" position, and it'd animate target→target, i.e. snap).
  // Brand-new nodes start at their parent's position, so they grow out of it.
  cy.nodes().forEach((n) => {
    const id = n.id();
    const target = { ...n.position() };
    const start = old.get(id) ?? old.get(parentOf.get(id)) ?? target;
    if (start.x === target.x && start.y === target.y) return; // nothing to move
    n.stop();
    n.position(start);
    n.animate({ position: target }, { duration: ANIM_MS, easing: "ease-out" });
  });
}

// --- live build -------------------------------------------------------------

function draw(fiber) {
  if (!fiber.parent) reset();

  const id = idFor(fiber);
  fiberById.set(id, fiber);
  if (!fiber.parent) rootNodeId = id;

  if (!added.has(id)) {
    cy.add({ group: "nodes", data: { id, label: labelFor(fiber) }, classes: kindClass(fiber) });
    added.add(id);

    if (fiber.parent) {
      const pid = idFor(fiber.parent);
      cy.add({
        group: "edges",
        data: { id: `child_${pid}_${id}`, source: pid, target: id },
        classes: "child",
      });

      const sibs = childrenByParent.get(pid) ?? [];
      if (sibs.length) {
        const prev = sibs[sibs.length - 1];
        cy.add({
          group: "edges",
          data: { id: `sib_${prev}_${id}`, source: prev, target: id },
          classes: "sibling",
        });
      }
      sibs.push(id);
      childrenByParent.set(pid, sibs);
      parentOf.set(id, pid);
    }
  }

  // Live highlight: previous active becomes "done", this fiber becomes active.
  if (lastActiveId && lastActiveId !== id) {
    cy.getElementById(lastActiveId).removeClass("active").addClass("done");
  }
  cy.getElementById(id).removeClass("done").addClass("active");
  lastActiveId = id;

  relayout();
}

// --- the movie: record + replay ---------------------------------------------

function recordFrame() {
  frames.push({ present: cy.elements().map((e) => e.id()), active: lastActiveId });
  scrubber.max = String(frames.length - 1);
}

// Render an arbitrary recorded frame: show the elements present then, hide the
// rest (positions are untouched, so nothing moves), and derive highlights.
function renderFrame(i) {
  const frame = frames[i];
  if (!frame) return;
  const present = new Set(frame.present);
  cy.batch(() => {
    cy.elements().forEach((el) => {
      if (present.has(el.id())) {
        el.removeClass("hidden");
        if (el.isNode()) {
          el.removeClass("active").removeClass("done");
          el.addClass(el.id() === frame.active ? "active" : "done");
        }
      } else {
        el.addClass("hidden");
      }
    });
  });
  updateLabel();
}

function updateLabel() {
  const i = Number(scrubber.value);
  frameLabel.textContent = frames.length ? `${i + 1} / ${frames.length}` : "0 / 0";
}

// --- playback controls ------------------------------------------------------

function pause() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  if (playBtn) playBtn.textContent = "▶";
}

function play() {
  if (!frames.length) return;
  following = false;
  if (Number(scrubber.value) >= frames.length - 1) scrubber.value = "0";
  renderFrame(Number(scrubber.value));
  playBtn.textContent = "⏸";
  playTimer = setInterval(() => {
    let v = Number(scrubber.value);
    if (v >= frames.length - 1) {
      pause();
      return;
    }
    v += 1;
    scrubber.value = String(v);
    renderFrame(v);
  }, PLAYBACK_MS);
}

if (scrubber) {
  scrubber.addEventListener("input", () => {
    pause();
    // Dragging to the far right re-enables live following.
    following = Number(scrubber.value) >= frames.length - 1;
    renderFrame(Number(scrubber.value));
  });
}
if (playBtn) {
  playBtn.addEventListener("click", () => (playTimer ? pause() : play()));
}
if (startBtn) {
  startBtn.addEventListener("click", () => {
    pause();
    following = false;
    scrubber.value = "0";
    renderFrame(0);
  });
}

// --- the trace hook ---------------------------------------------------------

globalThis.__didactTrace = function trace(fiber) {
  // Must never break Didact: this runs inside performUnitOfWork.
  try {
    draw(fiber);
    recordFrame();
    if (following) {
      scrubber.value = String(frames.length - 1);
      updateLabel();
    } else {
      // User is scrubbing/paused — keep their view stable as the build runs on.
      renderFrame(Number(scrubber.value));
    }
  } catch (err) {
    console.error("[fiber-viz] trace failed (ignored):", err);
  }
};
