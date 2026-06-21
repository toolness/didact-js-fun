// Fiber-graph visualizer. This file is ENTIRELY separate from your Didact
// library — it just listens. The only contact point is that performUnitOfWork
// calls `globalThis.__didactTrace(fiber)` once per unit of work (the "[viz
// hook]" line in didact.js). We install that function here and draw the fiber
// tree as it grows, in lockstep with your work loop.
//
// You never need to edit this file to work through the tutorial.

import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

const cy = cytoscape({
  container: document.getElementById("fiber-graph"),
  // Layout/zoom are driven entirely by us; disable user panning so the graph
  // stays put while you watch it build.
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
    // The root container fiber.
    { selector: "node.root", style: { "background-color": "#1a1a2e" } },
    // Text fibers (TEXT_ELEMENT) get a softer color.
    { selector: "node.text", style: { "background-color": "#8b80e0", "font-style": "italic" } },
    // The fiber currently being processed by performUnitOfWork.
    {
      selector: "node.active",
      style: {
        "background-color": "#e0245e",
        "border-width": 4,
        "border-color": "#ffb3c8",
      },
    },
    // Fibers already processed.
    { selector: "node.done", style: { opacity: 0.85 } },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        width: 2,
        "target-arrow-shape": "triangle",
      },
    },
    // child links: solid, the actual tree shape.
    {
      selector: "edge.child",
      style: { "line-color": "#5b4bdb", "target-arrow-color": "#5b4bdb" },
    },
    // sibling links: dashed, the horizontal chain between children.
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
let activeId = null;

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
  cy.elements().remove();
  added = new Set();
  childrenByParent = new Map();
  activeId = null;
}

function relayout() {
  // Lay out using only the nodes and the child edges. Excluding the sibling
  // edges from the layout collection means dagre ranks purely by the tree
  // structure (no crossings from horizontal sibling links); the dashed
  // sibling edges are still drawn, just between already-positioned nodes.
  cy.elements()
    .not("edge.sibling")
    .layout({
      name: "dagre",
      rankDir: "TB",
      nodeSep: 24,
      rankSep: 48,
      animate: true,
      animationDuration: 180,
      fit: true,
      padding: 24,
    })
    .run();
}

// --- the trace hook itself --------------------------------------------------

globalThis.__didactTrace = function trace(fiber) {
  // The viz must never break Didact: this hook runs *inside* performUnitOfWork,
  // so a thrown error here would kill the work loop. Swallow + log instead.
  try {
    draw(fiber);
  } catch (err) {
    console.error("[fiber-viz] trace failed (ignored):", err);
  }
};

function draw(fiber) {
  // A fiber with no parent is a fresh render root — start the graph over.
  if (!fiber.parent) reset();

  const id = idFor(fiber);

  // Add this fiber's node the first time we see it.
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

      // Siblings are visited in order for a given parent, so the previous
      // entry in this parent's list is this fiber's left sibling.
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
    }
  }

  // Move the "active" highlight to the fiber being processed right now.
  if (activeId && activeId !== id) {
    cy.getElementById(activeId).removeClass("active").addClass("done");
  }
  cy.getElementById(id).addClass("active");
  activeId = id;

  relayout();
}
