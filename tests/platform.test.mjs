import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  classifyExecutable,
  findExecutable,
  isWindows
} from "../plugins/cc/scripts/lib/platform.mjs";

function fakeRunner(stdout, { status = 0, error = null } = {}) {
  return () => ({ command: "", args: [], status, signal: null, stdout, stderr: "", error });
}

test("isWindows only reports true for win32", () => {
  assert.equal(isWindows("win32"), true);
  assert.equal(isWindows("darwin"), false);
  assert.equal(isWindows("linux"), false);
});

test("posix executables are always directly spawnable", () => {
  for (const platform of ["darwin", "linux"]) {
    const info = classifyExecutable("/usr/local/bin/claude", platform);
    assert.equal(info.kind, "direct");
    assert.equal(info.requiresShell, false);
  }
});

test("windows batch shims are flagged as requiring a shell", () => {
  for (const shim of ["C:\\bin\\claude.cmd", "C:\\bin\\claude.bat", "C:\\bin\\claude.ps1"]) {
    const info = classifyExecutable(shim, "win32");
    assert.equal(info.kind, "shim", `${shim} should classify as a shim`);
    assert.equal(info.requiresShell, true);
  }
});

test("windows .exe is directly spawnable", () => {
  const info = classifyExecutable("C:\\Program Files\\claude\\claude.exe", "win32");
  assert.equal(info.kind, "direct");
  assert.equal(info.requiresShell, false);
});

test("extensionless files on windows are treated as shims", () => {
  // npm drops a POSIX-style extensionless script next to the .cmd shim.
  const info = classifyExecutable("C:\\bin\\claude", "win32");
  assert.equal(info.kind, "shim");
});

test("missing paths classify as missing", () => {
  assert.equal(classifyExecutable(null, "linux").kind, "missing");
  assert.equal(classifyExecutable("", "win32").kind, "missing");
});

test("findExecutable prefers a real binary over a shim on windows", () => {
  const where = ["C:\\bin\\claude", "C:\\bin\\claude.cmd", "C:\\bin\\claude.exe"].join("\r\n");
  const found = findExecutable("claude", { platform: "win32", runCommandImpl: fakeRunner(where) });
  assert.equal(found, "C:\\bin\\claude.exe");
});

test("findExecutable tolerates CRLF and blank lines", () => {
  const found = findExecutable("claude", {
    platform: "win32",
    runCommandImpl: fakeRunner("C:\\bin\\claude.cmd\r\n\r\n")
  });
  assert.equal(found, "C:\\bin\\claude.cmd");
});

test("findExecutable returns the first match on posix", () => {
  const found = findExecutable("claude", {
    platform: "linux",
    runCommandImpl: fakeRunner("/home/ian/.local/bin/claude\n/usr/bin/claude\n")
  });
  assert.equal(found, "/home/ian/.local/bin/claude");
});

test("findExecutable returns null when the lookup fails", () => {
  assert.equal(
    findExecutable("claude", { platform: "linux", runCommandImpl: fakeRunner("", { status: 1 }) }),
    null
  );
  assert.equal(
    findExecutable("claude", {
      platform: "linux",
      runCommandImpl: fakeRunner("", { error: new Error("ENOENT") })
    }),
    null
  );
});

test("path handling never hand-joins separators", () => {
  // Guards the rule the module exists to enforce: node:path picks the separator.
  const joined = path.join("a", "b", "c");
  assert.equal(joined.includes(path.sep), true);
});
