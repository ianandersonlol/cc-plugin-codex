import fs from "node:fs";
import path from "node:path";

/**
 * Interpolate {{TOKEN}} placeholders.
 *
 * Replacement is done with a function callback so that `$&`, `$1`, and friends
 * inside a user's focus text or a diff summary are treated as literal text
 * rather than as replacement patterns.
 */
export function interpolate(template, values) {
  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token) => {
    const value = values[token];
    return value === undefined || value === null ? match : String(value);
  });
}

export function loadPrompt(pluginRoot, name) {
  const promptPath = path.join(pluginRoot, "prompts", `${name}.md`);
  return fs.readFileSync(promptPath, "utf8");
}

export function buildReviewPrompt(pluginRoot, name, values) {
  return interpolate(loadPrompt(pluginRoot, name), values);
}
