/**
 * Graph visualization for state machines and counterexample traces.
 *
 * Generates a self-contained HTML file with Mermaid.js diagrams showing:
 *   1. The state machine structure (fields, actions, invariants)
 *   2. Each counterexample trace as a step-by-step violation path
 */

import type { StateMachineIR } from "../contracts/state-machine-schema.js";
import type {
  SearchResult,
  CounterexampleTrace,
  StateSnapshot,
} from "../trace/bounded-search.js";

// ---------------------------------------------------------------------------
// Mermaid diagram builders
// ---------------------------------------------------------------------------

function escapeLabel(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/[<>]/g, "");
}

function formatState(state: StateSnapshot): string {
  return Object.entries(state)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join("\n");
}

/**
 * Build a Mermaid flowchart showing the state machine's actions as
 * transitions from/to an abstract "State" node.
 */
function buildMachineGraph(ir: StateMachineIR): string {
  const lines: string[] = ["flowchart LR"];

  // Initial state node
  const initFields = ir.initialValues
    .map((iv) => `${iv.field} = ${JSON.stringify(iv.value)}`)
    .join("\\n");
  lines.push(`  Init(["**Init**\\n${escapeLabel(initFields)}"]):::initNode`);

  // Central state node showing fields
  const fieldList = ir.stateFields
    .map((f) => `${f.name}: ${f.type}`)
    .join("\\n");
  lines.push(`  State(["**${escapeLabel(ir.name)}**\\n${escapeLabel(fieldList)}"]):::stateNode`);

  lines.push(`  Init -->|initialize| State`);

  // Action self-loop edges
  for (const action of ir.actions) {
    const effects = action.effects
      .map((e) => `${e.field} := ${escapeLabel(e.expression)}`)
      .join("\\n");
    const paramStr = action.params.length > 0
      ? `(${action.params.map((p) => `${p.name}: ${p.type}`).join(", ")})`
      : "";
    const label = `${action.name}${paramStr}\\n${effects}`;
    lines.push(`  State -->|"${label}"| State`);
  }

  // Invariant nodes
  for (let i = 0; i < ir.invariants.length; i++) {
    const inv = ir.invariants[i];
    const id = `Inv${i}`;
    lines.push(`  ${id}{{"**${escapeLabel(inv.name)}**\\n${escapeLabel(inv.expression)}"}}:::invNode`);
    lines.push(`  State -.-|must hold| ${id}`);
  }

  // Normalization
  for (let i = 0; i < ir.normalization.length; i++) {
    const rule = ir.normalization[i];
    const id = `Norm${i}`;
    const label = `if ${escapeLabel(rule.condition)}\\nthen ${rule.field} := ${escapeLabel(rule.value)}`;
    lines.push(`  ${id}["${label}"]:::normNode`);
    lines.push(`  State -.->|normalize| ${id}`);
  }

  return lines.join("\n");
}

/**
 * Build a Mermaid flowchart showing a counterexample trace as a linear
 * chain of concrete state snapshots connected by action edges.
 */
function buildTraceGraph(ir: StateMachineIR, trace: CounterexampleTrace, index: number): string {
  const lines: string[] = ["flowchart TD"];

  if (trace.steps.length === 0) {
    // Violation at init
    const stateStr = formatState(trace.finalState).replace(/\n/g, "\\n");
    lines.push(`  S0(["**Init**\\n${escapeLabel(stateStr)}"]):::failNode`);
    lines.push(`  Fail0["INVARIANT VIOLATED\\n${escapeLabel(trace.failingInvariant)}"]:::failLabel`);
    lines.push(`  S0 --- Fail0`);
    return lines.join("\n");
  }

  // Init node
  const initState = trace.steps[0].beforeState;
  const initStr = formatState(initState).replace(/\n/g, "\\n");
  lines.push(`  S0(["**Init**\\n${escapeLabel(initStr)}"]):::initNode`);

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const afterStr = formatState(step.afterState).replace(/\n/g, "\\n");
    const isLast = i === trace.steps.length - 1;
    const nodeClass = isLast ? "failNode" : "stepNode";

    const paramStr = Object.keys(step.params).length > 0
      ? `(${Object.entries(step.params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`
      : "";

    lines.push(`  S${i + 1}(["**Step ${i + 1}**\\n${escapeLabel(afterStr)}"]):::${nodeClass}`);
    lines.push(`  S${i} -->|"${escapeLabel(step.action)}${escapeLabel(paramStr)}"| S${i + 1}`);
  }

  // Failure annotation
  lines.push(`  Fail${index}["INVARIANT VIOLATED\\n${escapeLabel(trace.failingInvariant)}"]:::failLabel`);
  lines.push(`  S${trace.steps.length} --- Fail${index}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

export function renderGraphHTML(
  ir: StateMachineIR,
  searchResult: SearchResult,
): string {
  const machineGraph = buildMachineGraph(ir);

  const traceGraphs = searchResult.counterexamples.map((trace, i) => ({
    title: `Counterexample ${i + 1}: ${trace.failingInvariant} violated (${trace.steps.length} step${trace.steps.length !== 1 ? "s" : ""})`,
    mermaid: buildTraceGraph(ir, trace, i),
  }));

  const traceHTML = traceGraphs.length > 0
    ? traceGraphs.map((g) => `
      <div class="section">
        <h2>${escapeHTML(g.title)}</h2>
        <pre class="mermaid">
${g.mermaid}
        </pre>
      </div>`).join("\n")
    : `<div class="section success"><h2>No counterexamples found</h2><p>All invariants held across ${searchResult.explored} explored states (depth ${searchResult.maxDepthReached}).</p></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(ir.name)} — Proof Visualization</title>
<style>
  :root {
    --bg: #0d1117;
    --fg: #c9d1d9;
    --card: #161b22;
    --border: #30363d;
    --accent: #58a6ff;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    padding: 2rem;
    line-height: 1.5;
  }
  h1 {
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
    color: var(--accent);
  }
  .subtitle {
    color: #8b949e;
    margin-bottom: 2rem;
    font-size: 0.95rem;
  }
  .section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .section h2 {
    font-size: 1.2rem;
    margin-bottom: 1rem;
    color: var(--fg);
  }
  .section.success h2 { color: var(--green); }
  .section.success { border-color: var(--green); }
  .stats {
    display: flex;
    gap: 2rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }
  .stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.5rem;
    min-width: 160px;
  }
  .stat .label { color: #8b949e; font-size: 0.85rem; }
  .stat .value { font-size: 1.4rem; font-weight: 600; }
  .stat .value.pass { color: var(--green); }
  .stat .value.fail { color: var(--red); }
  .stat .value.warn { color: var(--yellow); }
  .mermaid { text-align: center; }
  pre.mermaid { background: transparent; border: none; }
</style>
</head>
<body>

<h1>${escapeHTML(ir.name)}</h1>
<p class="subtitle">${escapeHTML(ir.description)}</p>

<div class="stats">
  <div class="stat">
    <div class="label">State Fields</div>
    <div class="value">${ir.stateFields.length}</div>
  </div>
  <div class="stat">
    <div class="label">Actions</div>
    <div class="value">${ir.actions.length}</div>
  </div>
  <div class="stat">
    <div class="label">Invariants</div>
    <div class="value">${ir.invariants.length}</div>
  </div>
  <div class="stat">
    <div class="label">States Explored</div>
    <div class="value">${searchResult.explored}</div>
  </div>
  <div class="stat">
    <div class="label">Max Depth</div>
    <div class="value">${searchResult.maxDepthReached}</div>
  </div>
  <div class="stat">
    <div class="label">Counterexamples</div>
    <div class="value ${searchResult.counterexamples.length > 0 ? "fail" : "pass"}">${searchResult.counterexamples.length}</div>
  </div>
</div>

<div class="section">
  <h2>State Machine Structure</h2>
  <pre class="mermaid">
${machineGraph}
  </pre>
</div>

${traceHTML}

<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: true,
    theme: 'dark',
    themeVariables: {
      primaryColor: '#1f6feb',
      primaryTextColor: '#c9d1d9',
      primaryBorderColor: '#388bfd',
      lineColor: '#8b949e',
      secondaryColor: '#161b22',
      tertiaryColor: '#21262d',
    },
    flowchart: {
      curve: 'basis',
      padding: 15,
      htmlLabels: true,
    },
  });
</script>

<style>
  .initNode > * { fill: #1f6feb !important; stroke: #388bfd !important; color: #fff !important; }
  .stateNode > * { fill: #21262d !important; stroke: #58a6ff !important; color: #c9d1d9 !important; }
  .stepNode > * { fill: #161b22 !important; stroke: #8b949e !important; color: #c9d1d9 !important; }
  .failNode > * { fill: #3d1214 !important; stroke: #f85149 !important; color: #f85149 !important; }
  .failLabel > * { fill: #f85149 !important; stroke: #f85149 !important; color: #fff !important; }
  .invNode > * { fill: #1a2332 !important; stroke: #d29922 !important; color: #d29922 !important; }
  .normNode > * { fill: #1a2332 !important; stroke: #8b949e !important; color: #8b949e !important; }
</style>

</body>
</html>`;
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
