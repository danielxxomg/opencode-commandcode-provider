import { expect, test } from "bun:test"
import {
  gatherContext,
  gatherStructure,
  parseGitignore,
  shouldSkip,
  clearContextCache,
} from "../../src/context.js"

test("parseGitignore extracts clean pattern set", () => {
  const patterns = parseGitignore(process.cwd())
  expect(patterns instanceof Set).toBe(true)
})

test("shouldSkip identifies default directories and pattern matches", () => {
  const patterns = new Set(["*.log", "secret/"])
  expect(shouldSkip("node_modules", "node_modules", patterns)).toBe(true)
  expect(shouldSkip(".git", ".git", patterns)).toBe(true)
  expect(shouldSkip("dist", "dist", patterns)).toBe(true)
  expect(shouldSkip("debug.log", "debug.log", patterns)).toBe(true)
  expect(shouldSkip("secret", "secret", patterns)).toBe(true)
  expect(shouldSkip("main.ts", "src/main.ts", patterns)).toBe(false)
})

test("gatherStructure collects files and respects boundaries", () => {
  const structure = gatherStructure(process.cwd())
  expect(Array.isArray(structure)).toBe(true)
  expect(structure.length).toBeGreaterThan(0)
  // Shouldn't contain node_modules or .git files
  expect(structure.some((p) => p.startsWith("node_modules"))).toBe(false)
  expect(structure.some((p) => p.startsWith(".git/"))).toBe(false)
})

test("gatherContext returns structure and git metadata with caching", () => {
  clearContextCache()
  const ctx1 = gatherContext(process.cwd())
  expect(ctx1.structure).toBeDefined()
  expect(ctx1.git).toBeDefined()
  expect(typeof ctx1.git.isGitRepo).toBe("boolean")

  // Second immediate call should return the exact cached object reference
  const ctx2 = gatherContext(process.cwd())
  expect(ctx2).toBe(ctx1)

  // Clearing cache allows fresh generation
  clearContextCache()
  const ctx3 = gatherContext(process.cwd())
  expect(ctx3).not.toBe(ctx1)
})
