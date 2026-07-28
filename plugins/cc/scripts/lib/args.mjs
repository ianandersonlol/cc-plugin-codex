/**
 * Argument parsing for the companion CLI.
 *
 * Codex passes a slash command's `$ARGUMENTS` through as a single string, so
 * the companion accepts both a real argv array and one packed string.
 */

/**
 * Split a packed argument string, honouring single and double quotes so a
 * focus phrase survives as one token.
 */
export function tokenize(input) {
  const tokens = [];
  let current = "";
  let quote = null;
  let hasContent = false;

  for (const char of String(input)) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasContent || current.length > 0) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }

    current += char;
    hasContent = true;
  }

  if (hasContent || current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parse tokens into flags and free text.
 *
 * `valueOptions` take the next token as their value; `booleanOptions` do not.
 * Anything unrecognised is preserved in `rest`, which becomes the user's focus
 * text — the review prompt must never lose it.
 */
export function parseArgs(input, spec = {}) {
  const tokens = Array.isArray(input) ? input.slice() : tokenize(input ?? "");
  const valueOptions = new Set(spec.valueOptions ?? []);
  const booleanOptions = new Set(spec.booleanOptions ?? []);

  const options = {};
  const rest = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }

    const body = token.slice(2);
    const equals = body.indexOf("=");
    const name = equals === -1 ? body : body.slice(0, equals);
    const inlineValue = equals === -1 ? null : body.slice(equals + 1);

    if (booleanOptions.has(name)) {
      options[name] = inlineValue === null ? true : inlineValue !== "false";
      continue;
    }

    if (valueOptions.has(name)) {
      if (inlineValue !== null) {
        options[name] = inlineValue;
        continue;
      }
      const next = tokens[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for --${name}`);
      }
      options[name] = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: --${name}`);
  }

  return { options, rest, focusText: rest.join(" ").trim() };
}
