import { expect, test, beforeEach, mock, afterAll } from "bun:test"
import * as realFs from "node:fs"

// Mock fs so existsSync returns false for auth paths — prevents reading real ~/.commandcode/auth.json
mock.module("fs", () => ({
  existsSync: (p: string) => {
    if (typeof p === "string" && (p.includes(".commandcode") || p.includes(".pi"))) return false
    return realFs.existsSync(p)
  },
  readFileSync: realFs.readFileSync.bind(realFs),
}))

const { resolveApiKey } = await import("../../src/auth.js")

beforeEach(() => {
  delete process.env.COMMANDCODE_API_KEY
})

test("resolves from explicit apiKey option", () => {
  const result = resolveApiKey({ apiKey: "sk-explicit" })
  expect(result).toBe("sk-explicit")
})

test("resolves from COMMANDCODE_API_KEY env var", () => {
  process.env.COMMANDCODE_API_KEY = "sk-from-env"
  const result = resolveApiKey({})
  expect(result).toBe("sk-from-env")
})

test("explicit apiKey takes priority over env var", () => {
  process.env.COMMANDCODE_API_KEY = "sk-from-env"
  const result = resolveApiKey({ apiKey: "sk-explicit" })
  expect(result).toBe("sk-explicit")
})

test("returns undefined when no key found", () => {
  const result = resolveApiKey({})
  expect(result).toBeUndefined()
})

test("uses env override from options.env over process.env", () => {
  process.env.COMMANDCODE_API_KEY = "sk-from-process-env"
  const result = resolveApiKey({ env: { COMMANDCODE_API_KEY: "sk-from-options-env" } })
  expect(result).toBe("sk-from-options-env")
})

test("falls through to process.env when options.env is missing key", () => {
  process.env.COMMANDCODE_API_KEY = "sk-from-process-env"
  const result = resolveApiKey({ env: {} })
  expect(result).toBe("sk-from-process-env")
})
