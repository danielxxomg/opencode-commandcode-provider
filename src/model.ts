import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamResult,
  LanguageModelV3GenerateResult,
  LanguageModelV3Content,
  LanguageModelV3Usage,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import { buildRequest } from "./convert.js"
import { gatherContext } from "./context.js"
import { parseStreamEvents } from "./stream.js"

const DEFAULT_BASE_URL = "https://api.commandcode.ai"
// x-command-code-version must match the Command Code CLI version for API compatibility
const CC_VERSION = "0.26.20"

// --- Retry config ---
// Max 3 retries after the initial attempt (4 total). Backoff schedule with
// jitter keeps reconnects short: ~1s, ~2.5s, ~5s (±25% jitter).
const MAX_RETRIES = 3
const BACKOFF_SCHEDULE_MS = [1000, 2500, 5000] as const
const REQUEST_TIMEOUT_MS = 300_000

// --- error classification ---

/**
 * Extract a lowercased, searchable message from an error of any shape.
 * Handles Error instances, strings, and the plain SSE error objects Command
 * Code emits (e.g. { type: "server_error", message: "Network connection lost." }).
 */
function extractMessage(err: unknown): string {
  if (err === null || err === undefined) return ""
  if (err instanceof Error) return err.message.toLowerCase()
  if (typeof err === "string") return err.toLowerCase()
  if (typeof err === "object") {
    const e = err as Record<string, unknown>
    const nested = e.error as Record<string, unknown> | undefined
    const parts: string[] = []
    for (const v of [e.message, nested?.message, e.msg, nested?.type, e.type, e.code]) {
      if (typeof v === "string" && v) parts.push(v)
    }
    if (parts.length) return parts.join(" ").toLowerCase()
    try {
      return JSON.stringify(err).toLowerCase()
    } catch {
      return ""
    }
  }
  return String(err).toLowerCase()
}

// Non-transient failures: never retry these. Matched conservatively (specific
// phrases) so genuine transient errors are never misclassified as permanent.
const NON_RETRYABLE_PATTERNS = [
  "insufficient credit",
  "insufficient_credit",
  "model_not_in_plan",
  "model not in plan",
  "not_in_plan",
  "not in plan",
  "usage limit",
  "usage_limit",
  "exceeded your",
  "quota exceeded",
  "unauthorized",
  "forbidden",
  "invalid api key",
  "invalid_api_key",
  "authentication",
  "auth_error",
  "permission_denied",
  "validation_error",
  "bad request",
  "not found",
]

// Transient failures: safe to retry when no content has been emitted yet.
const RETRYABLE_PATTERNS = [
  "network connection lost",
  "connection lost",
  "connection reset",
  "connection refused",
  "connection timeout",
  "server_error",
  "server error",
  "internal server error",
  "internal error",
  "aborted",
  "aborterror",
  "abort_error",
  "fetch failed",
  "fetchfailed",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "terminated",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "downstream",
  "temporarily unavailable",
]

function isNonRetryableError(err: unknown): boolean {
  const msg = extractMessage(err)
  if (!msg) return false
  return NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p))
}

function isRetryableError(err: unknown): boolean {
  if (isNonRetryableError(err)) return false
  const msg = extractMessage(err)
  if (!msg) return false
  return RETRYABLE_PATTERNS.some((p) => msg.includes(p))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function backoffDelay(attempt: number): number {
  const base = BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)] ?? 5000
  // jitter ±25% to avoid synchronized retry storms
  return base * (0.75 + Math.random() * 0.5)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function wrapAsError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === "string") return new Error(err)
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

function partialOutputError(original: unknown): Error {
  const err = new Error(
    `Command Code stream failed after partial output was already emitted; reconnect aborted to avoid duplicate content. Original error: ${describeError(original)}`,
  )
  Object.assign(err, { partialOutput: true, ccError: original })
  return err
}

/**
 * Decide whether a failure should be retried.
 * Retry only when: the error is transient, NO substantive content has been
 * emitted yet (avoids dangerous duplicate regeneration), attempts remain, and
 * the request was not intentionally aborted (user cancel / hard timeout).
 */
function shouldRetry(
  err: unknown,
  emittedContent: boolean,
  attempt: number,
  maxRetries: number,
  aborted: boolean,
): boolean {
  if (aborted) return false
  if (emittedContent) return false
  if (attempt >= maxRetries) return false
  return isRetryableError(err)
}

async function buildHttpError(response: Response, modelId: string): Promise<Error> {
  const errorBody = await response.text().catch(() => "")
  let message = `Command Code API error: ${response.status} ${response.statusText}`
  let type = ""
  try {
    const parsed = JSON.parse(errorBody)
    if (parsed?.error?.message) message = parsed.error.message
    else if (parsed?.message) message = parsed.message
    if (parsed?.error?.type) type = parsed.error.type
    else if (parsed?.type) type = parsed.type
  } catch {
    // intentionally silent: error body is not JSON
  }
  const err = new Error(`${message} [model=${modelId}]`)
  if (type) Object.assign(err, { code: type })
  return err
}

export interface CommandCodeModelOptions {
  apiKey: string
  baseURL?: string
  headers?: Record<string, string>
}

export class CommandCodeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider = "commandcode"
  readonly modelId: string
  supportedUrls: Record<string, RegExp[]> = {}

  private opts: CommandCodeModelOptions

  constructor(modelId: string, opts: CommandCodeModelOptions) {
    this.modelId = modelId
    this.opts = opts
  }

  private get baseURL(): string {
    return this.opts.baseURL ?? DEFAULT_BASE_URL
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.opts.apiKey}`,
      "x-command-code-version": CC_VERSION,
      "x-cli-environment": "production",
      "x-project-slug": "opencode",
      ...this.opts.headers,
    }
  }

  /**
   * Initial connection with retry/backoff for transient network and 5xx/429
   * failures. 4xx (auth, plan, credits, validation) are thrown immediately.
   */
  private async fetchWithRetry(url: string, fetchOpts: RequestInit, maxRetries: number = MAX_RETRIES): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOpts)
        if (response.ok) return response
        const err = await buildHttpError(response, this.modelId)
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const delay = backoffDelay(attempt)
          console.error(
            `[CC-Retry] HTTP ${response.status} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms: ${err.message}`,
          )
          await sleep(delay)
          continue
        }
        throw err
      } catch (err) {
        lastError = err
        if (!isRetryableError(err) || attempt >= maxRetries) throw err
        const delay = backoffDelay(attempt)
        console.error(
          `[CC-Retry] network error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms: ${describeError(err)}`,
        )
        await sleep(delay)
      }
    }
    throw lastError
  }

  /**
   * Single fetch used for mid-stream reconnects. The retry budget for
   * reconnects is owned by streamWithReconnect (no double counting).
   * 5xx/429 are tagged with a `server_error` token so the wrapper classifies
   * them as retryable; 4xx throw the parsed (non-retryable) error.
   */
  private async fetchOnce(url: string, fetchOpts: RequestInit): Promise<Response> {
    const response = await fetch(url, fetchOpts)
    if (response.ok) return response
    const err = await buildHttpError(response, this.modelId)
    if (isRetryableStatus(response.status)) {
      throw new Error(`server_error: reconnect HTTP ${response.status} (${err.message})`)
    }
    throw err
  }

  /**
   * Wraps a parsed stream to detect mid-stream disconnects and transparently
   * reconnect — BUT only when no substantive content (text, reasoning,
   * tool-call, tool-input) has been emitted yet. If partial output already
   * went downstream, reconnecting would regenerate from scratch and produce
   * DUPLICATE content, so we instead surface a clear error.
   */
  private streamWithReconnect(
    makeStream: () => ReadableStream<LanguageModelV3StreamPart>,
    reconnect: () => Promise<ReadableStream<LanguageModelV3StreamPart>>,
    isAborted: () => boolean,
    maxRetries: number = MAX_RETRIES,
  ): ReadableStream<LanguageModelV3StreamPart> {
    let attempt = 0
    let currentStream = makeStream()
    let reader = currentStream.getReader()
    let emittedContent = false
    let pendingReconnect = false

    return new ReadableStream<LanguageModelV3StreamPart>({
      async pull(controller) {
        while (true) {
          if (pendingReconnect) {
            pendingReconnect = false
            try {
              currentStream = await reconnect()
              reader = currentStream.getReader()
              continue
            } catch (reconnectErr) {
              if (shouldRetry(reconnectErr, emittedContent, attempt, maxRetries, isAborted())) {
                attempt++
                const delay = backoffDelay(attempt - 1)
                console.error(
                  `[CC-Retry-Stream] reconnect failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(delay)}ms: ${describeError(reconnectErr)}`,
                )
                await sleep(delay)
                pendingReconnect = true
                continue
              }
              if (emittedContent) {
                controller.error(partialOutputError(reconnectErr))
              } else {
                controller.error(wrapAsError(reconnectErr))
              }
              return
            }
          }

          let readResult: ReadableStreamReadResult<LanguageModelV3StreamPart>
          try {
            readResult = await reader.read()
          } catch (err) {
            if (shouldRetry(err, emittedContent, attempt, maxRetries, isAborted())) {
              attempt++
              const delay = backoffDelay(attempt - 1)
              console.error(
                `[CC-Retry-Stream] mid-stream disconnect (attempt ${attempt}/${maxRetries}), reconnecting in ${Math.round(delay)}ms: ${describeError(err)}`,
              )
              await sleep(delay)
              pendingReconnect = true
              continue
            }
            if (emittedContent) {
              controller.error(partialOutputError(err))
            } else {
              controller.error(wrapAsError(err))
            }
            return
          }

          const { done, value } = readResult
          if (done) {
            controller.close()
            return
          }
          if (!value) continue

          // Track substantive content emission — gates safe reconnect.
          if (
            value.type === "text-delta" ||
            value.type === "reasoning-delta" ||
            value.type === "tool-call" ||
            value.type === "tool-input-start" ||
            value.type === "tool-input-delta"
          ) {
            emittedContent = true
          }

          // Defensive: stream.ts converts SSE errors into controller.error(),
          // so an {type:"error"} part should never arrive here. If it does,
          // treat it as a terminal failure with retry gating.
          if (value.type === "error") {
            const inner = (value as { error?: unknown }).error
            if (shouldRetry(inner, emittedContent, attempt, maxRetries, isAborted())) {
              attempt++
              const delay = backoffDelay(attempt - 1)
              console.error(
                `[CC-Retry-Stream] error part (attempt ${attempt}/${maxRetries}), reconnecting in ${Math.round(delay)}ms: ${describeError(inner)}`,
              )
              await sleep(delay)
              pendingReconnect = true
              continue
            }
            if (emittedContent) {
              controller.error(partialOutputError(inner))
            } else {
              controller.error(wrapAsError(inner))
            }
            return
          }

          controller.enqueue(value)
          return
        }
      },
      cancel() {
        reader.cancel()
      },
    })
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const context = gatherContext()
    const body = buildRequest(this.modelId, options, context)
    const requestBody = JSON.stringify(body)

    const controller = new AbortController()
    let userAborted = false
    const timeout = setTimeout(
      () => controller.abort(new Error("Request timed out after 5 minutes")),
      REQUEST_TIMEOUT_MS,
    )
    const userSignal = options.abortSignal
    if (userSignal) {
      const onAbort = () => {
        userAborted = true
        controller.abort(userSignal.reason)
      }
      userSignal.addEventListener("abort", onAbort, { once: true })
    }

    const url = `${this.baseURL}/alpha/generate`
    const fetchOpts = (): RequestInit => ({
      method: "POST",
      headers: this.buildHeaders(),
      body: requestBody,
      signal: controller.signal,
    })

    const isAborted = () => userAborted || controller.signal.aborted

    try {
      const response = await this.fetchWithRetry(url, fetchOpts())

      if (!response.body) {
        throw new Error(`Command Code API returned no body [model=${this.modelId}]`)
      }

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v
      })

      const makeStream = () => parseStreamEvents(response.body as ReadableStream<Uint8Array>)
      const reconnect = async (): Promise<ReadableStream<LanguageModelV3StreamPart>> => {
        const r = await this.fetchOnce(url, fetchOpts())
        if (!r.body) throw new Error("server_error: reconnect returned no body")
        return parseStreamEvents(r.body as ReadableStream<Uint8Array>)
      }

      return {
        stream: this.streamWithReconnect(makeStream, reconnect, isAborted),
        request: { body: requestBody },
        response: { headers: responseHeaders },
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { stream } = await this.doStream(options)

    const textParts: string[] = []
    const reasoningParts: string[] = []
    const content: LanguageModelV3Content[] = []
    let finishReason: LanguageModelV3FinishReason = { unified: "stop", raw: "stop" }
    let usage: LanguageModelV3Usage = {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    }

    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        switch (value.type) {
          case "text-delta":
            textParts.push(value.delta)
            break
          case "reasoning-delta":
            reasoningParts.push(value.delta)
            break
          case "tool-call":
            content.push({
              type: "tool-call",
              toolCallId: value.toolCallId,
              toolName: value.toolName,
              input: value.input,
            })
            break
          case "finish":
            finishReason = value.finishReason
            usage = value.usage
            break
        }
      }
    } finally {
      reader.releaseLock()
      stream.cancel()
    }

    const text = textParts.join("")
    if (text) content.unshift({ type: "text", text })

    const reasoning = reasoningParts.join("")
    if (reasoning) content.unshift({ type: "reasoning", text: reasoning })

    return {
      content,
      finishReason,
      usage,
      warnings: [],
    }
  }
}
