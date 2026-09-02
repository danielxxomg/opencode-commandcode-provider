import type { LanguageModelV3StreamPart, LanguageModelV3Usage, LanguageModelV3FinishReason } from "@ai-sdk/provider"

type RawEvent = Record<string, unknown> & { type: string }

/**
 * Wrap an SSE error payload (which may be a plain object like
 * `{ type: "server_error", message: "Network connection lost." }`, a string,
 * or an Error) into a real Error so it terminates the ReadableStream via
 * controller.error(). The original object is preserved on `ccError` and the
 * type is exposed as `code` so downstream retry logic can classify it.
 */
function wrapError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === "string") {
    const e = new Error(err)
    return e
  }
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>
    const nested = e.error as Record<string, unknown> | undefined
    const message =
      (typeof e.message === "string" && e.message) ||
      (typeof nested?.message === "string" && nested.message) ||
      (typeof e.msg === "string" && e.msg) ||
      (() => {
        try {
          return JSON.stringify(err)
        } catch {
          return "Unknown error"
        }
      })()
    const type =
      (typeof e.type === "string" && e.type) ||
      (typeof nested?.type === "string" && nested.type) ||
      undefined
    const error = new Error(type ? `${type}: ${message}` : String(message))
    Object.assign(error, { ccError: err, ...(type ? { code: type } : {}) })
    return error
  }
  return new Error(String(err ?? "Unknown error"))
}

function mapFinishReason(raw: string): LanguageModelV3FinishReason["unified"] {
  switch (raw) {
    case "stop":
    case "end_turn":
      return "stop"
    case "tool_calls":
    case "tool-calls":
      return "tool-calls"
    case "length":
    case "max_tokens":
    case "max-tokens":
    case "max_output_tokens":
      return "length"
    case "content_filter":
      return "content-filter"
    default:
      return "other"
  }
}

function mapUsage(raw: Record<string, unknown>): LanguageModelV3Usage {
  const inputDetails = (raw.inputTokenDetails ?? raw.input_token_details ?? {}) as Record<string, unknown>
  const outputDetails = (raw.outputTokenDetails ?? raw.output_token_details ?? {}) as Record<string, unknown>
  return {
    inputTokens: {
      total: typeof raw.inputTokens === "number" ? raw.inputTokens : typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : undefined,
      noCache: typeof inputDetails.noCacheTokens === "number" ? inputDetails.noCacheTokens : undefined,
      cacheRead: typeof inputDetails.cacheReadTokens === "number" ? inputDetails.cacheReadTokens : undefined,
      cacheWrite: typeof inputDetails.cacheWriteTokens === "number" ? inputDetails.cacheWriteTokens : undefined,
    },
    outputTokens: {
      total: typeof raw.outputTokens === "number" ? raw.outputTokens : typeof raw.completion_tokens === "number" ? raw.completion_tokens : undefined,
      text: typeof outputDetails.textTokens === "number" ? outputDetails.textTokens : undefined,
      reasoning: typeof outputDetails.reasoningTokens === "number" ? outputDetails.reasoningTokens : undefined,
    },
  }
}

function toStreamPart(event: RawEvent): LanguageModelV3StreamPart | null {
  switch (event.type) {
    case "start":
      return { type: "stream-start", warnings: [] }

    case "text-start":
      return { type: "text-start", id: event.id as string }
    case "text-delta":
      return { type: "text-delta", id: event.id as string, delta: (event.text ?? event.delta ?? "") as string }
    case "text-end":
      return { type: "text-end", id: event.id as string }

    case "reasoning-start":
      return { type: "reasoning-start", id: event.id as string }
    case "reasoning-delta":
      return { type: "reasoning-delta", id: event.id as string, delta: (event.text ?? event.delta ?? "") as string }
    case "reasoning-end":
      return { type: "reasoning-end", id: event.id as string }

    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: event.id as string,
        toolName: event.toolName as string,
        dynamic: event.dynamic as boolean | undefined,
      }
    case "tool-input-delta":
      return { type: "tool-input-delta", id: event.id as string, delta: (event.delta ?? "") as string }
    case "tool-input-end":
      return { type: "tool-input-end", id: event.id as string }

    case "tool-call": {
      const input = event.input ?? event.args ?? event.arguments
      return {
        type: "tool-call",
        toolCallId: (event.toolCallId ?? event.id ?? "") as string,
        toolName: event.toolName as string,
        input: typeof input === "string" ? input : JSON.stringify(input ?? {}),
      }
    }

    case "finish-step": {
      const usage = event.usage ?? event.totalUsage ?? {}
      const rawReason = (event.finishReason ?? event.rawFinishReason ?? "stop") as string
      return {
        type: "finish",
        finishReason: { unified: mapFinishReason(rawReason), raw: rawReason },
        usage: mapUsage(typeof usage === "object" && usage !== null ? (usage as Record<string, unknown>) : {}),
      }
    }

    case "finish":
      return null

    case "response-metadata":
      return {
        type: "response-metadata",
        id: event.id as string | undefined,
        modelId: event.modelId as string | undefined,
      }

    // NOTE: `error` is intentionally NOT mapped to a stream part here.
    // SSE error events are converted into ReadableStream terminations via
    // controller.error() in parseStreamEvents() so the AI SDK and the retry
    // wrapper in model.ts see a real failure (with the original error object
    // preserved on err.ccError) instead of a silent part.
    case "error":
      return null

    default:
      return null
  }
}

// Assumes line-delimited JSON over SSE: one JSON object per `data:` line.
// Multi-line `data:` fields are not supported — the buffer splits on `\n`.
export function parseStreamEvents(body: ReadableStream<Uint8Array>): ReadableStream<LanguageModelV3StreamPart> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(controller) {
      try {
        while (true) {
          const lines = buffer.split("\n")
          // Strip trailing \r from Windows-style \r\n line endings
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line !== undefined && line.endsWith("\r")) lines[i] = line.slice(0, -1)
          }
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith(":") || trimmed === "[DONE]") continue

            let jsonStr = trimmed
            if (jsonStr.startsWith("data: ")) jsonStr = jsonStr.slice(6)
            if (jsonStr.startsWith("data:")) jsonStr = jsonStr.slice(5)
            if (!jsonStr || jsonStr === "[DONE]") continue

            let parsed: RawEvent
            try {
              parsed = JSON.parse(jsonStr)
            } catch {
              // intentionally silent: skip malformed SSE lines
              continue
            }

            if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") continue

            // SSE-level error: terminate the stream with a real Error so the
            // retry layer can classify it. Preserve the original payload.
            if (parsed.type === "error") {
              controller.error(wrapError(parsed.error ?? parsed.message ?? "Unknown Command Code stream error"))
              return
            }

            const part = toStreamPart(parsed)
            if (part) controller.enqueue(part)
          }

          const { done, value } = await reader.read()
          if (done) {
            if (buffer.trim()) {
              const trimmed = buffer.trim()
              if (trimmed && trimmed !== "[DONE]" && !trimmed.startsWith(":")) {
                let jsonStr = trimmed
                if (jsonStr.startsWith("data: ")) jsonStr = jsonStr.slice(6)
                if (jsonStr.startsWith("data:")) jsonStr = jsonStr.slice(5)
                try {
                  const parsed = JSON.parse(jsonStr)
                  if (typeof parsed === "object" && parsed !== null && typeof parsed.type === "string") {
                    if (parsed.type === "error") {
                      controller.error(wrapError(parsed.error ?? parsed.message ?? "Unknown Command Code stream error"))
                      return
                    }
                    const part = toStreamPart(parsed)
                    if (part) controller.enqueue(part)
                  }
                } catch {
                  // intentionally silent: skip malformed final buffer
                }
              }
            }
            controller.close()
            return
          }

          buffer += decoder.decode(value, { stream: true })
        }
      } catch (err) {
        // Network/read-level failure: terminate the stream with the real error
        // so the retry layer can decide whether to reconnect.
        controller.error(wrapError(err))
      }
    },
    cancel() {
      reader.cancel()
    },
  })
}
