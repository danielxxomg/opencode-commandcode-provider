import { expect, test } from "bun:test"
import {
  loadModels,
  toConfigKey,
  toV1ModelConfig,
  toV2ModelDraft,
  toV2ModelMap,
  type ModelEntry,
} from "../../src/models.js"

const sampleEntry: ModelEntry = {
  id: "deepseek/deepseek-v4-flash",
  name: "DeepSeek V4 Flash",
  tier: "open-source",
  reasoning: true,
  tool_call: true,
  capabilities: {
    vision: true,
    pdf: false,
    reasoning: true,
    tool_call: true,
  },
  variants: { fast: "deepseek/deepseek-v4-flash-fast" },
  cost: { input: 0.14, output: 0.28, cache_read: 0.014, cache_write: 0.14 },
  limit: { context: 1000000, output: 131072 },
}

test("loadModels loads the bundled catalog with at least 50 models", () => {
  const models = loadModels()
  expect(Array.isArray(models)).toBe(true)
  expect(models.length).toBeGreaterThanOrEqual(50)
  for (const m of models) {
    expect(m.id).toBeDefined()
    expect(m.name).toBeDefined()
    expect(m.limit.context).toBeGreaterThan(0)
  }
})

test("toConfigKey strips provider prefix and lowercases", () => {
  expect(toConfigKey("deepseek/deepseek-v4-flash")).toBe("deepseek-v4-flash")
  expect(toConfigKey("Qwen/Qwen3.7-Flash")).toBe("qwen3.7-flash")
  expect(toConfigKey("claude-sonnet-5")).toBe("claude-sonnet-5")
  expect(toConfigKey("META/MUSE-SPARK-1.1")).toBe("muse-spark-1.1")
})

test("toV1ModelConfig converts model to V1 format preserving capabilities and cost", () => {
  const v1 = toV1ModelConfig(sampleEntry)
  expect(v1.id).toBe("deepseek/deepseek-v4-flash")
  expect(v1.name).toBe("DeepSeek V4 Flash")
  expect(v1.reasoning).toBe(true)
  expect(v1.tool_call).toBe(true)
  expect(v1.capabilities?.vision).toBe(true)
  expect(v1.variants?.fast).toBe("deepseek/deepseek-v4-flash-fast")
  expect(v1.cost.input).toBe(0.14)
  expect(v1.cost.output).toBe(0.28)
  expect(v1.limit.context).toBe(1000000)
})

test("toV2ModelDraft converts to OpenCode 2 shape including vision/pdf capabilities", () => {
  const v2 = toV2ModelDraft(sampleEntry)
  expect(v2.modelID).toBe("deepseek/deepseek-v4-flash")
  expect(v2.name).toBe("DeepSeek V4 Flash")
  expect(v2.capabilities.tools).toBe(true)
  expect(v2.capabilities.input).toContain("text")
  expect(v2.capabilities.input).toContain("image")
  expect(v2.capabilities.output).toContain("text")
  expect(v2.limit.context).toBe(1000000)
  expect(v2.cost.input).toBe(0.14)
})

test("toV2ModelMap indexes drafts by config key", () => {
  const map = toV2ModelMap([sampleEntry])
  expect(map["deepseek-v4-flash"]).toBeDefined()
  expect(map["deepseek-v4-flash"].modelID).toBe("deepseek/deepseek-v4-flash")
})
