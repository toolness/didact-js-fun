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
// It also hosts the work-loop config widgets at the bottom of the pane, which
// drive Didact's one public knob: Didact.setConfig({...}). That's the only
// place this file reaches into the library — everything else is observe-only.
//
// You never need to edit this file to work through the tutorial.

import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import Didact from "./didact.ts";

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
        // Animate only the ghost-fade (opacity), so ghost -> filled is smooth
        // but the active cursor and effect colors stay crisp.
        "transition-property": "opacity, background-opacity, border-opacity",
        "transition-duration": "0.18s",
      },
    },
    { selector: "node.root", style: { "background-color": "#1a1a2e" } },
    { selector: "node.text", style: { "background-color": "#8b80e0", "font-style": "italic" } },
    // Effect-tag coloring (background): green = added (PLACEMENT), blue =
    // actually changed (UPDATE), gray + faded = UPDATE that changed nothing.
    { selector: "node.eff-placement", style: { "background-color": "#23a45a" } },
    { selector: "node.eff-update", style: { "background-color": "#2f6fed" } },
    { selector: "node.eff-noop", style: { "background-color": "#9aa0ad", opacity: 0.4 } },
    // Ghost = the previously-committed tree, shown as a faint outline that the
    // new render fills in. Keying nodes by structural position (not fiber
    // identity) lets them persist across renders, so this also kills the reflow.
    {
      selector: "node.ghost",
      style: {
        opacity: 0.3,
        "background-opacity": 0.12,
        "border-width": 1.5,
        "border-color": "#8890a0",
        "border-opacity": 1,
      },
    },
    {
      selector: "edge.ghost",
      style: { opacity: 0.2 },
    },
    {
      selector: "node.active",
      style: {
        "background-color": "#e0245e",
        "border-width": 4,
        "border-color": "#ffb3c8",
      },
    },
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

// A node's id is its STRUCTURAL POSITION in the tree ("r", "r.0", "r.0.1", …),
// NOT the fiber object's identity. So the same position keeps the same node
// across renders: re-renders reuse (and recolor) nodes instead of destroying
// and rebuilding them — which is what removes the per-render reflow, and lets
// the previous tree linger as a ghost the new render fills in.
function keyFor(fiber) {
  if (!fiber.parent) return "r";
  let i = 0;
  let s = fiber.parent.child;
  while (s && s !== fiber) {
    s = s.sibling;
    i++;
  }
  return `${keyFor(fiber.parent)}.${i}`;
}

const ROOT_ID = "r";
let childrenByParent = new Map(); // parent id -> [child ids] in sibling order (derived)
let parentOf = new Map(); // child id -> parent id (derived)
let fiberById = new Map(); // node id -> current fiber (to find its real DOM node on hover)
let lastActiveId = null;
let rootNodeId = ROOT_ID;
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

const isEvent = (key) => key.startsWith("on");
const isOwnProp = (key) => key !== "children" && !isEvent(key);

// Did this fiber's own props/handlers actually change vs. its previous fiber?
// (Same comparison updateDom does — children are separate fibers, ignored here.)
function propsChanged(fiber) {
  const prev = fiber.alternate?.props ?? {};
  const next = fiber.props ?? {};
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!isOwnProp(key) && !isEvent(key)) continue;
    if (prev[key] !== next[key]) return true;
  }
  return false;
}

// effectTag is already set by the time a fiber is traced, so we can color the
// node by it. An UPDATE whose props didn't actually change is a "no-op".
function effectClass(fiber) {
  switch (fiber.effectTag) {
    case "PLACEMENT":
      return "eff-placement";
    case "UPDATE":
      return propsChanged(fiber) ? "eff-update" : "eff-noop";
    default:
      return ""; // root / untagged
  }
}

// Rebuild the parent/children maps purely from the structural node ids present
// in the graph (e.g. "r.0.1" -> parent "r.0", index 1). No incremental
// bookkeeping to keep in sync — we derive it whenever the structure changes.
function rebuildStructure() {
  childrenByParent = new Map();
  parentOf = new Map();
  for (const n of cy.nodes()) {
    const id = n.id();
    if (id === ROOT_ID) continue;
    const dot = id.lastIndexOf(".");
    const pid = id.slice(0, dot);
    const idx = Number(id.slice(dot + 1));
    parentOf.set(id, pid);
    const arr = childrenByParent.get(pid) ?? [];
    arr[idx] = id;
    childrenByParent.set(pid, arr);
  }
  for (const [pid, arr] of childrenByParent) {
    childrenByParent.set(pid, arr.filter((x) => x != null)); // drop holes
  }
}

// Called when a new render starts (the root fiber is traced). Instead of
// clearing the graph, we fade the whole committed tree to a ghost that the new
// render fills in. Nodes still ghosted from the PREVIOUS pass were never
// refilled (i.e. they were deleted), so prune them first.
function startRenderPass() {
  pause();
  cy.elements(".ghost").remove(); // leftover ghosts = deletions from last pass
  rebuildStructure();
  cy.nodes().addClass("ghost").removeClass("active");
  cy.edges().addClass("ghost");
  lastActiveId = null;
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
  if (!fiber.parent) startRenderPass();

  const id = keyFor(fiber);
  fiberById.set(id, fiber); // remember the CURRENT fiber at this position (for hover)

  let structureChanged = false;

  if (cy.getElementById(id).empty()) {
    // Brand-new structural position → create the node and its edges.
    cy.add({
      group: "nodes",
      data: { id, label: labelFor(fiber) },
      classes: `${kindClass(fiber)} ${effectClass(fiber)}`.trim(),
    });
    if (fiber.parent) {
      const pid = keyFor(fiber.parent);
      cy.add({ group: "edges", data: { id: `child_${id}`, source: pid, target: id }, classes: "child" });
      const idx = Number(id.slice(id.lastIndexOf(".") + 1));
      if (idx > 0) {
        const prevId = `${pid}.${idx - 1}`;
        if (cy.getElementById(prevId).nonempty()) {
          cy.add({ group: "edges", data: { id: `sib_${id}`, source: prevId, target: id }, classes: "sibling" });
        }
      }
    }
    structureChanged = true;
  } else {
    // Existing node (a ghost from last render, or already filled this pass) →
    // fill it in: refresh its label and effect-tag color in place. No layout.
    const node = cy.getElementById(id);
    node.data("label", labelFor(fiber));
    node.removeClass("ghost eff-placement eff-update eff-noop root text element");
    node.addClass(`${kindClass(fiber)} ${effectClass(fiber)}`.trim());
  }

  // Un-ghost this node and the edges leading into it.
  const el = cy.getElementById(id);
  el.removeClass("ghost");
  el.incomers("edge").removeClass("ghost");

  // Live highlight: move the "active" (being-worked-on) marker to this fiber.
  if (lastActiveId && lastActiveId !== id) {
    cy.getElementById(lastActiveId).removeClass("active");
  }
  el.addClass("active");
  lastActiveId = id;

  // Only re-lay-out when the structure actually changed — re-renders with the
  // same shape reuse positions, so there's no reflow.
  if (structureChanged) {
    rebuildStructure();
    relayout();
  }
}

// --- the movie: record + replay ---------------------------------------------

// Snapshot the full visual state (every element's class list) after this step,
// so the scrubber can replay the ghost -> filled progression exactly.
function recordFrame() {
  const states = {};
  cy.elements().forEach((el) => {
    states[el.id()] = el.classes().join(" ");
  });
  frames.push(states);
  scrubber.max = String(frames.length - 1);
}

// Replay a recorded frame by restoring every element's classes. Elements that
// didn't exist yet at that frame are hidden (positions are untouched, so
// nothing moves).
function renderFrame(i) {
  const frame = frames[i];
  if (!frame) return;
  cy.batch(() => {
    cy.elements().forEach((el) => {
      const cls = frame[el.id()];
      if (cls === undefined) el.addClass("hidden");
      else el.classes(cls); // restore exact classes (also clears "hidden")
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

// --- work-loop config widgets -----------------------------------------------
// The number inputs at the bottom of the pane drive Didact.setConfig. setConfig
// replaces the whole Config object, so we keep a local mirror (seeded with the
// library's defaults) and push the full object on every change.

const chunkSizeInput = document.getElementById("cfg-chunk-size");
const msBetweenInput = document.getElementById("cfg-ms-between");

// Mirrors DEFAULT_CONFIG in didact.ts — keep these in sync with the inputs'
// initial `value` attributes in index.html.
const liveConfig = { unitOfWorkChunkSize: 1, msBetweenChunks: 1 };

// Read an input as a non-negative number, falling back to the current value
// when the field is empty or garbage (so a half-typed entry never breaks the
// loop). `min` clamps the floor (1 for chunk size, 0 for the delay).
function readNumber(input, fallback, min) {
  const n = Number(input.value);
  if (input.value === "" || Number.isNaN(n)) return fallback;
  return Math.max(min, n);
}

function applyConfig() {
  if (chunkSizeInput) {
    liveConfig.unitOfWorkChunkSize = readNumber(chunkSizeInput, liveConfig.unitOfWorkChunkSize, 1);
  }
  if (msBetweenInput) {
    liveConfig.msBetweenChunks = readNumber(msBetweenInput, liveConfig.msBetweenChunks, 0);
  }
  Didact.setConfig({ ...liveConfig });
}

if (chunkSizeInput) chunkSizeInput.addEventListener("input", applyConfig);
if (msBetweenInput) msBetweenInput.addEventListener("input", applyConfig);

// Push the initial values once so the inputs and the library agree from frame 0.
applyConfig();

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
