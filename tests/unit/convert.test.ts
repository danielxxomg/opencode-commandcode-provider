import { expect, test } from "bun:test"
import { buildRequest } from "../../src/convert.js"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

function makeOpts(overrides: Partial<LanguageModelV3CallOptions> = {}): LanguageModelV3CallOptions {
  return {
    prompt: [],
    maxOutputTokens: 1000,
    ...overrides,
  }
}

test("builds minimal request envelope", () => {
  const req = buildRequest("test-model", makeOpts())
  expect(req.params.model).toBe("test-model")
  expect(req.params.stream).toBe(true)
  expect(req.params.messages).toEqual([])
  expect(req.params.tools).toEqual([])
  expect(req.params.system).toBe("")
  expect(req.params.max_tokens).toBe(1000)
})

test("concatenates system prompts", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "system", content: "You write TypeScript." },
    ],
  }))
  expect(req.params.system).toBe("You are a helpful assistant.\n\nYou write TypeScript.")
})

test("converts user message with string content", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{ role: "user", content: "hello" }],
  }))
  expect(req.params.messages).toHaveLength(1)
  expect(req.params.messages[0]).toEqual({ role: "user", content: "hello" })
})

test("converts user message with array of text parts", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "user",
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    }],
  }))
  expect(req.params.messages).toHaveLength(1)
  expect(req.params.messages[0]).toEqual({ role: "user", content: "line1\nline2" })
})

test("user message with non-text parts drops them silently", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "image", url: "https://example.com/img.png" },
      ],
    }],
  }))
  expect(req.params.messages).toHaveLength(1)
  const msg = req.params.messages[0] as { role: "user"; content: string }
  expect(msg.content).toBe("hello")
})

test("converts assistant message with text, reasoning, and tool-call parts", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "assistant",
      content: [
        { type: "text", text: "I think" },
        { type: "reasoning", text: "hmm..." },
        { type: "tool-call", toolCallId: "tc1", toolName: "bash", input: { cmd: "ls" } },
      ],
    }],
  }))
  expect(req.params.messages).toHaveLength(1)
  const msg = req.params.messages[0] as { role: "assistant"; content: unknown[] }
  expect(msg.content).toHaveLength(3)
  expect(msg.content[0]).toEqual({ type: "text", text: "I think" })
  expect(msg.content[1]).toEqual({ type: "reasoning", text: "hmm..." })
  expect(msg.content[2]).toEqual({ type: "tool-call", toolCallId: "tc1", toolName: "bash", input: { cmd: "ls" } })
})

test("converts tool result message with text output", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "bash",
        output: { type: "text", value: "file.ts" },
      }],
    }],
  }))
  const msg = req.params.messages[0] as { role: "tool"; content: unknown[] }
  expect(msg.content[0]).toEqual({
    type: "tool-result",
    toolCallId: "tc1",
    toolName: "bash",
    output: { type: "text", value: "file.ts" },
  })
})

test("converts tool result with error-text output", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "bash",
        output: { type: "error-text", value: "command not found" },
      }],
    }],
  }))
  const msg = req.params.messages[0] as { role: "tool"; content: unknown[] }
  const out = msg.content[0] as { output: { type: string; value: string } }
  expect(out.output.type).toBe("error-text")
  expect(out.output.value).toBe("command not found")
})

test("converts tool result with json output", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "bash",
        output: { type: "json", value: { key: "val" } },
      }],
    }],
  }))
  const msg = req.params.messages[0] as { role: "tool"; content: unknown[] }
  const out = msg.content[0] as { output: { type: string; value: string } }
  expect(out.output.type).toBe("text")
  expect(JSON.parse(out.output.value)).toEqual({ key: "val" })
})

test("converts tool result with execution-denied output", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "bash",
        output: { type: "execution-denied", reason: "not allowed" },
      }],
    }],
  }))
  const msg = req.params.messages[0] as { role: "tool"; content: unknown[] }
  const out = msg.content[0] as { output: { type: string; value: string } }
  expect(out.output.type).toBe("error-text")
  expect(out.output.value).toBe("not allowed")
})

test("skips unknown message roles", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{ role: "unknown" as never, content: "test" }],
  }))
  expect(req.params.messages).toHaveLength(0)
})

test("converts function tools", () => {
  const req = buildRequest("m", makeOpts({
    tools: [
      {
        type: "function",
        name: "my_tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }))
  expect(req.params.tools).toHaveLength(1)
  expect(req.params.tools[0]).toEqual({
    type: "function",
    name: "my_tool",
    description: "A test tool",
    input_schema: { type: "object", properties: {} },
  })
})

test("filters out provider tools", () => {
  const req = buildRequest("m", makeOpts({
    tools: [
      { type: "function", name: "func_tool", description: "", inputSchema: {} },
      { type: "provider", id: "provider.tool" as `${string}.${string}`, name: "prov_tool", args: {} },
    ],
  }))
  expect(req.params.tools).toHaveLength(1)
  expect(req.params.tools[0].name).toBe("func_tool")
})

test("passes through temperature, topP, topK", () => {
  const req = buildRequest("m", makeOpts({
    prompt: [{ role: "user", content: "hi" }],
    temperature: 0.5,
    topP: 0.9,
    topK: 40,
  }))
  expect(req.params.temperature).toBe(0.5)
  expect(req.params.top_p).toBe(0.9)
  expect(req.params.top_k).toBe(40)
})

test("defaults max_tokens to 16384 when not provided", () => {
  const req = buildRequest("m", makeOpts({ maxOutputTokens: undefined }))
  expect(req.params.max_tokens).toBe(16384)
})

test("envelope has correct top-level shape", () => {
  const req = buildRequest("m", makeOpts())
  expect(req).toHaveProperty("config")
  expect(req).toHaveProperty("memory", "")
  expect(req).toHaveProperty("taste", "")
  expect(req).toHaveProperty("skills", null)
  expect(req).toHaveProperty("permissionMode", "standard")
  expect(req).toHaveProperty("params")
})

test("passes through project context structure and git state", () => {
  const req = buildRequest("m", makeOpts(), {
    structure: ["src/", "src/index.ts"],
    git: {
      isGitRepo: true,
      currentBranch: "feature-branch",
      mainBranch: "main",
      gitStatus: "M src/index.ts",
      recentCommits: ["abc1234 initial"],
    },
  })
  expect(req.config.structure).toEqual(["src/", "src/index.ts"])
  expect(req.config.isGitRepo).toBe(true)
  expect(req.config.currentBranch).toBe("feature-branch")
  expect(req.config.gitStatus).toBe("M src/index.ts")
})

test("passes through thinking and reasoning_effort options", () => {
  const req1 = buildRequest("m", makeOpts({
    providerMetadata: {
      commandcode: {
        thinking: { type: "enabled", budget_tokens: 4096 },
      },
    },
  } as any))
  expect(req1.params.thinking).toEqual({ type: "enabled", budget_tokens: 4096 })

  const req2 = buildRequest("m", makeOpts({
    reasoningEffort: "high",
  } as any))
  expect(req2.params.reasoning_effort).toBe("high")
})
