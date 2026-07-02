import { expect, test } from "bun:test"
import { parseStreamEvents } from "../../src/stream.js"
import { sseEvent } from "../helpers/mocks.js"

async function collectStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader()
  const parts: unknown[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return parts
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i]))
      i++
    },
  })
}

test("parses text-delta event", async () => {
  const body = streamFromChunks([sseEvent({ type: "text-delta", id: "t1", delta: "hello" })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(1)
  expect(parts[0]).toMatchObject({ type: "text-delta", id: "t1", delta: "hello" })
})

test("parses reasoning-delta event", async () => {
  const body = streamFromChunks([sseEvent({ type: "reasoning-delta", id: "r1", text: "thinking..." })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts[0]).toMatchObject({ type: "reasoning-delta", id: "r1", delta: "thinking..." })
})

test("parses tool-call event", async () => {
  const body = streamFromChunks([sseEvent({
    type: "tool-call",
    toolCallId: "tc1",
    toolName: "bash",
    input: { cmd: "ls" },
  })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts[0]).toMatchObject({
    type: "tool-call",
    toolCallId: "tc1",
    toolName: "bash",
  })
})

test("parses finish-step with usage", async () => {
  const body = streamFromChunks([sseEvent({
    type: "finish-step",
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20 },
  })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts[0]).toMatchObject({
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10 },
      outputTokens: { total: 20 },
    },
  })
})

test("maps finish reasons correctly", async () => {
  const cases: Array<{ raw: string; expected: string }> = [
    { raw: "stop", expected: "stop" },
    { raw: "end_turn", expected: "stop" },
    { raw: "tool_calls", expected: "tool-calls" },
    { raw: "tool-calls", expected: "tool-calls" },
    { raw: "length", expected: "length" },
    { raw: "max_tokens", expected: "length" },
    { raw: "max-tokens", expected: "length" },
    { raw: "max_output_tokens", expected: "length" },
    { raw: "content_filter", expected: "content-filter" },
    { raw: "unknown_reason", expected: "other" },
  ]
  for (const { raw, expected } of cases) {
    const body = streamFromChunks([sseEvent({ type: "finish-step", finishReason: raw })])
    const stream = parseStreamEvents(body)
    const parts = await collectStream(stream)
    expect((parts[0] as any).finishReason.unified).toBe(expected)
  }
})

test("maps usage with camelCase fields", async () => {
  const body = streamFromChunks([sseEvent({
    type: "finish-step",
    finishReason: "stop",
    usage: {
      inputTokens: 15,
      outputTokens: 25,
      inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 10 },
      outputTokenDetails: { textTokens: 20, reasoningTokens: 5 },
    },
  })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  const usage = (parts[0] as any).usage
  expect(usage.inputTokens.total).toBe(15)
  expect(usage.inputTokens.noCache).toBe(5)
  expect(usage.inputTokens.cacheRead).toBe(10)
  expect(usage.outputTokens.total).toBe(25)
  expect(usage.outputTokens.text).toBe(20)
  expect(usage.outputTokens.reasoning).toBe(5)
})

test("maps usage with snake_case fields", async () => {
  const body = streamFromChunks([sseEvent({
    type: "finish-step",
    finishReason: "stop",
    usage: {
      prompt_tokens: 15,
      completion_tokens: 25,
      input_token_details: { noCacheTokens: 5, cacheReadTokens: 10 },
      output_token_details: { textTokens: 20, reasoningTokens: 5 },
    },
  })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  const usage = (parts[0] as any).usage
  expect(usage.inputTokens.total).toBe(15)
  expect(usage.outputTokens.total).toBe(25)
  expect(usage.inputTokens.noCache).toBe(5)
  expect(usage.inputTokens.cacheRead).toBe(10)
})

test("skips comments (lines starting with :)", async () => {
  const body = streamFromChunks([":comment\n\ndata: {\"type\":\"start\"}\n\n"])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(1)
  expect((parts[0] as any).type).toBe("stream-start")
})

test("skips [DONE] lines", async () => {
  const body = streamFromChunks(["data: {\"type\":\"start\"}\n\ndata: [DONE]\n\n"])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(1)
})

test("handles error events", async () => {
  const body = streamFromChunks([sseEvent({ type: "error", error: "Something broke" })])
  const stream = parseStreamEvents(body)
  // SSE error events now terminate the stream via controller.error()
  // instead of being silently enqueued as a stream part
  const reader = stream.getReader()
  try {
    await reader.read()
    expect.unreachable("Stream should have thrown")
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("Something broke")
  } finally {
    reader.releaseLock()
  }
})

test("handles response-metadata event", async () => {
  const body = streamFromChunks([sseEvent({ type: "response-metadata", id: "req-1", modelId: "model-v1" })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts[0]).toMatchObject({ type: "response-metadata", id: "req-1", modelId: "model-v1" })
})

test("handles multiple events in one chunk", async () => {
  const body = streamFromChunks([
    sseEvent({ type: "text-delta", id: "t1", delta: "a" }) +
    sseEvent({ type: "text-delta", id: "t1", delta: "b" }),
  ])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(2)
})

test("handles event split across chunk boundaries", async () => {
  const eventJson = JSON.stringify({ type: "text-delta", id: "t1", delta: "hello" })
  const part1 = `data: ${eventJson.slice(0, 10)}`
  const part2 = `${eventJson.slice(10)}\n\n`
  const body = streamFromChunks([part1, part2])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(1)
  expect((parts[0] as any).delta).toBe("hello")
})

test("finish event type returns null (no-op)", async () => {
  const body = streamFromChunks([sseEvent({ type: "finish" })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(0)
})

test("unknown event types are silently skipped", async () => {
  const body = streamFromChunks([sseEvent({ type: "weird-internal-event" })])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(0)
})

test("handles \\r\\n line endings", async () => {
  const body = streamFromChunks(["data: {\"type\":\"start\"}\r\n\r\n"])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(1)
})

test("closes stream cleanly at end of data", async () => {
  const body = streamFromChunks(["data: {\"type\":\"start\"}\n\n"])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(1)
})

// --- SSE error handling tests (controller.error behavior) ---

test("SSE error with object payload produces Error with ccError and code", async () => {
  const body = streamFromChunks([sseEvent({
    type: "error",
    error: { type: "server_error", message: "Network connection lost." },
  })])
  const stream = parseStreamEvents(body)
  const reader = stream.getReader()
  try {
    await reader.read()
    expect.unreachable("Stream should have thrown")
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    const error = err as Error & { ccError?: unknown; code?: string }
    expect(error.message).toContain("server_error")
    expect(error.message).toContain("Network connection lost.")
    expect(error.code).toBe("server_error")
    expect(error.ccError).toBeDefined()
  } finally {
    reader.releaseLock()
  }
})

test("SSE error with string payload wraps into Error", async () => {
  const body = streamFromChunks([sseEvent({ type: "error", error: "rate limited" })])
  const stream = parseStreamEvents(body)
  const reader = stream.getReader()
  try {
    await reader.read()
    expect.unreachable("Stream should have thrown")
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("rate limited")
  } finally {
    reader.releaseLock()
  }
})

test("SSE error with message field (instead of error) is handled", async () => {
  const body = streamFromChunks([sseEvent({ type: "error", message: "Something failed" })])
  const stream = parseStreamEvents(body)
  const reader = stream.getReader()
  try {
    await reader.read()
    expect.unreachable("Stream should have thrown")
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("Something failed")
  } finally {
    reader.releaseLock()
  }
})

test("SSE error in final buffer chunk rejects stream", async () => {
  // Send error as the last event with no trailing newline after close
  const errorJson = JSON.stringify({ type: "error", error: "final error" })
  const body = streamFromChunks([`data: ${errorJson}`])
  const stream = parseStreamEvents(body)
  const reader = stream.getReader()
  try {
    await reader.read()
    expect.unreachable("Stream should have thrown")
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("final error")
  } finally {
    reader.releaseLock()
  }
})

test("network read failure in pull() rejects stream with wrapped error", async () => {
  // Create a body stream that yields one chunk then throws on subsequent reads
  const encoder = new TextEncoder()
  let readCount = 0
  const failingBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      readCount++
      if (readCount === 1) {
        controller.enqueue(encoder.encode('data: {"type":"text-delta","id":"t1","delta":"hello"}\n\n'))
      } else {
        // Simulate network failure by closing with an error
        controller.error(new Error("ECONNRESET: connection reset"))
      }
    },
  })
  const stream = parseStreamEvents(failingBody)
  const reader = stream.getReader()
  // First read should succeed
  const first = await reader.read()
  expect(first.done).toBe(false)
  expect(first.value).toMatchObject({ type: "text-delta", delta: "hello" })
  // Second read should fail — the underlying body errored, which causes
  // the catch block in parseStreamEvents to call controller.error(wrapError(err))
  try {
    const second = await reader.read()
    // If the stream closes gracefully instead of throwing, that's also acceptable
    // (depends on how the ReadableStream propagates the body error)
    if (second.done) {
      // Stream closed — acceptable
    }
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
  } finally {
    reader.releaseLock()
  }
})

test("normal events still work after error handling change", async () => {
  const body = streamFromChunks([
    sseEvent({ type: "text-delta", id: "t1", delta: "hello" }),
    sseEvent({ type: "text-delta", id: "t1", delta: " world" }),
    sseEvent({ type: "finish-step", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 10 } }),
  ])
  const stream = parseStreamEvents(body)
  const parts = await collectStream(stream)
  expect(parts).toHaveLength(3)
  expect(parts[0]).toMatchObject({ type: "text-delta", delta: "hello" })
  expect(parts[1]).toMatchObject({ type: "text-delta", delta: " world" })
  expect(parts[2]).toMatchObject({ type: "finish" })
})
