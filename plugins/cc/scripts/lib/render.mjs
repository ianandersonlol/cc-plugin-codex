/**
 * Rendering for the Codex terminal. Plain text with light markdown — no ANSI,
 * since the output is returned verbatim by a slash command and may be captured,
 * piped, or re-read by the model.
 */

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

function severityRank(severity) {
  const index = SEVERITY_ORDER.indexOf(String(severity).toLowerCase());
  return index === -1 ? SEVERITY_ORDER.length : index;
}

export function sortFindings(findings = []) {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

export function formatLocation(finding) {
  if (!finding.file) {
    return "(no location)";
  }
  const start = finding.line_start;
  const end = finding.line_end;
  if (!start) {
    return finding.file;
  }
  return end && end !== start ? `${finding.file}:${start}-${end}` : `${finding.file}:${start}`;
}

function formatConfidence(value) {
  if (typeof value !== "number") {
    return "";
  }
  return ` (confidence ${Math.round(value * 100)}%)`;
}

export function renderFinding(finding, index) {
  const severity = String(finding.severity ?? "unknown").toUpperCase();
  const lines = [
    `${index}. [${severity}] ${finding.title}`,
    `   ${formatLocation(finding)}${formatConfidence(finding.confidence)}`,
    "",
    indent(finding.body ?? "", "   ")
  ];

  if (finding.recommendation) {
    lines.push("", indent(`Recommendation: ${finding.recommendation}`, "   "));
  }

  return lines.join("\n");
}

function indent(text, prefix) {
  return String(text)
    .split("\n")
    .map((line) => (line.trim() ? `${prefix}${line}` : line))
    .join("\n");
}

/** Footer describing the run itself, so the numbers are never mistaken for findings. */
export function renderRunFooter(run = {}) {
  const parts = [];
  if (run.model) {
    parts.push(run.model);
  }
  if (typeof run.numTurns === "number") {
    parts.push(`${run.numTurns} turns`);
  }
  if (typeof run.durationMs === "number") {
    parts.push(`${(run.durationMs / 1000).toFixed(1)}s`);
  }
  if (typeof run.costUsd === "number") {
    parts.push(`$${run.costUsd.toFixed(3)}`);
  }
  return parts.length > 0 ? `— ${parts.join(" · ")}` : "";
}

export function renderReview(result, context = {}) {
  const structured = result.structured;

  if (!structured) {
    // The schema was not honoured; surface the raw text rather than pretending
    // there were no findings.
    return [
      `${context.title ?? "Review"}: no structured output returned.`,
      "",
      result.text || "(empty response)"
    ].join("\n");
  }

  const findings = sortFindings(structured.findings ?? []);
  const verdict = structured.verdict === "approve" ? "APPROVE" : "NEEDS ATTENTION";

  const lines = [`${context.title ?? "Review"} — ${verdict}`];

  if (context.target) {
    lines.push(`Target: ${context.target}`);
  }

  lines.push("", structured.summary ?? "");

  if (findings.length > 0) {
    lines.push("", `Findings (${findings.length}):`, "");
    findings.forEach((finding, index) => {
      lines.push(renderFinding(finding, index + 1), "");
    });
  } else {
    lines.push("", "No findings.");
  }

  const nextSteps = structured.next_steps ?? [];
  if (nextSteps.length > 0) {
    lines.push("", "Next steps:");
    nextSteps.forEach((step) => lines.push(`- ${step}`));
  }

  const warnings = renderWarnings(result);
  if (warnings) {
    lines.push("", warnings);
  }

  const footer = renderRunFooter({ ...result, model: context.model });
  if (footer) {
    lines.push("", footer);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Surface anything that would otherwise silently degrade the review: a reviewer
 * that tried to escape the read-only policy, or a run that hit rate limits.
 */
export function renderWarnings(result = {}) {
  const warnings = [];

  const denials = result.permissionDenials ?? [];
  if (denials.length > 0) {
    const names = [...new Set(denials.map((entry) => entry.tool_name ?? entry.toolName ?? "unknown"))];
    warnings.push(
      `Note: the reviewer attempted ${denials.length} denied tool call(s) (${names.join(", ")}). The read-only policy held.`
    );
  }

  if (result.rateLimited) {
    warnings.push("Note: this run reported a rate-limit event; results may be truncated.");
  }

  if (result.isError) {
    warnings.push("Note: the run reported an error status.");
  }

  return warnings.join("\n");
}

export function renderSetupReport(report) {
  const lines = ["cc setup", ""];

  const mark = (ok) => (ok ? "ok" : "MISSING");
  lines.push(`Node:         ${mark(report.node.available)} ${report.node.detail ?? ""}`.trimEnd());
  lines.push(
    `Claude Code:  ${mark(report.claude.available)} ${report.claude.detail ?? ""}`.trimEnd()
  );
  if (report.claude.path) {
    lines.push(`              ${report.claude.path} (${report.claude.source})`);
  }
  if (report.claude.kind === "shim") {
    lines.push(
      "              note: only a batch shim was found; a native install avoids shell quoting."
    );
  }
  lines.push(`Git repo:     ${mark(report.git.inside)} ${report.git.detail ?? ""}`.trimEnd());

  lines.push("", report.ready ? "Ready." : "Not ready.");

  if (report.nextSteps?.length > 0) {
    lines.push("", "Next steps:");
    report.nextSteps.forEach((step) => lines.push(`- ${step}`));
  }

  return lines.join("\n");
}
