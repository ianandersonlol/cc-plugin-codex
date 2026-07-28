import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLocation,
  renderReview,
  renderRunFooter,
  renderWarnings,
  sortFindings
} from "../plugins/cc/scripts/lib/render.mjs";

function finding(overrides = {}) {
  return {
    severity: "high",
    title: "Unchecked divisor",
    body: "The divisor is never validated.",
    file: "src/math.js",
    line_start: 10,
    line_end: 12,
    confidence: 0.8,
    recommendation: "Guard against zero.",
    ...overrides
  };
}

test("findings sort by severity, then by confidence", () => {
  const sorted = sortFindings([
    finding({ severity: "low", title: "low" }),
    finding({ severity: "critical", title: "critical" }),
    finding({ severity: "high", title: "high-weak", confidence: 0.2 }),
    finding({ severity: "high", title: "high-strong", confidence: 0.9 })
  ]);
  assert.deepEqual(sorted.map((entry) => entry.title), [
    "critical",
    "high-strong",
    "high-weak",
    "low"
  ]);
});

test("unknown severities sort last rather than being dropped", () => {
  const sorted = sortFindings([finding({ severity: "spicy" }), finding({ severity: "low" })]);
  assert.equal(sorted[0].severity, "low");
  assert.equal(sorted.length, 2);
});

test("locations render as clickable file:line references", () => {
  assert.equal(formatLocation(finding()), "src/math.js:10-12");
  assert.equal(formatLocation(finding({ line_end: 10 })), "src/math.js:10");
  assert.equal(formatLocation(finding({ line_start: null })), "src/math.js");
  assert.equal(formatLocation({ file: null }), "(no location)");
});

test("a review renders verdict, summary, findings, and next steps", () => {
  const output = renderReview(
    {
      structured: {
        verdict: "needs-attention",
        summary: "Do not ship yet.",
        findings: [finding()],
        next_steps: ["Add a zero guard", "Add a regression test"]
      },
      permissionDenials: [],
      numTurns: 4,
      durationMs: 42000,
      costUsd: 1.234
    },
    { title: "Adversarial review", target: "working tree", model: "opus", effort: "xhigh" }
  );

  assert.match(output, /Adversarial review — NEEDS ATTENTION/);
  assert.match(output, /Target: working tree/);
  assert.match(output, /Do not ship yet\./);
  assert.match(output, /1\. \[HIGH\] Unchecked divisor/);
  assert.match(output, /src\/math\.js:10-12 \(confidence 80%\)/);
  assert.match(output, /Recommendation: Guard against zero\./);
  assert.match(output, /- Add a regression test/);
  assert.match(output, /opus · xhigh effort · 4 turns · 42\.0s · \$1\.234/);
});

test("an approving review says so instead of listing nothing", () => {
  const output = renderReview(
    { structured: { verdict: "approve", summary: "Looks correct.", findings: [], next_steps: [] } },
    {}
  );
  assert.match(output, /APPROVE/);
  assert.match(output, /No findings\./);
});

test("missing structured output falls back to raw text rather than claiming success", () => {
  const output = renderReview({ structured: null, text: "auth error" }, { title: "Review" });
  assert.match(output, /no structured output returned/);
  assert.match(output, /auth error/);
});

test("denied tool calls are surfaced, not swallowed", () => {
  const warnings = renderWarnings({
    permissionDenials: [{ tool_name: "Write" }, { tool_name: "Write" }, { tool_name: "Edit" }]
  });
  assert.match(warnings, /3 denied tool call/);
  assert.match(warnings, /Write, Edit/);
  assert.match(warnings, /read-only policy held/);
});

test("rate limiting and error status are surfaced", () => {
  assert.match(renderWarnings({ rateLimited: true }), /rate-limit event/);
  assert.match(renderWarnings({ isError: true }), /error status/);
  assert.equal(renderWarnings({}), "");
});

test("the run footer omits fields that are absent", () => {
  assert.equal(renderRunFooter({}), "");
  assert.equal(renderRunFooter({ model: "sonnet" }), "— sonnet");
  assert.equal(renderRunFooter({ model: "fable", effort: "max" }), "— fable · max effort");
});
