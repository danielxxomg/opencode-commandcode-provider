import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type {
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3TextPart,
  LanguageModelV3ReasoningPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
  LanguageModelV3ToolResultOutput,
} from "@ai-sdk/provider"
import type { ProjectContext } from "./context.js"

type CCMessage =
  | { role: "user"; content: string | unknown[] }
  | { role: "assistant"; content: CCAssistantContent[] }
  | { role: "tool"; content: CCToolResultContent[] }

type CCAssistantContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }

type CCToolResultContent = {
  type: "tool-result"
  toolCallId: string
  toolName: string
  output: { type: "text"; value: string } | { type: "error-text"; value: string }
}

type CCTool = {
  type: "function"
  name: string
  description?: string
  input_schema: unknown
}

interface CCRequestEnvelope {
  config: {
    workingDir: string
    date: string
    environment: string
    structure: unknown[]
    isGitRepo: boolean
    currentBranch: string
    mainBranch: string
    gitStatus: string
    recentCommits: unknown[]
  }
  memory: string
  taste: string
  skills: null
  permissionMode: string
  params: {
    model: string
    messages: CCMessage[]
    tools: CCTool[]
    system: string
    max_tokens: number
    stream: true
    temperature?: number
    top_p?: number
    top_k?: number
    thinking?: unknown
    reasoning_effort?: string
  }
}

function hasType(p: unknown, type: string): boolean {
  return typeof p === "object" && p !== null && (p as { type?: string }).type === type
}

function isTextPart(p: unknown): p is LanguageModelV3TextPart {
  return hasType(p, "text")
}

function isReasoningPart(p: unknown): p is LanguageModelV3ReasoningPart {
  return hasType(p, "reasoning")
}

function isToolCallPart(p: unknown): p is LanguageModelV3ToolCallPart {
  return hasType(p, "tool-call")
}

function isToolResultPart(p: unknown): p is LanguageModelV3ToolResultPart {
  return hasType(p, "tool-result")
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const textParts = content.filter(isTextPart) as LanguageModelV3TextPart[]
    const nonTextParts = content.filter((p) => !isTextPart(p))
    if (nonTextParts.length > 0 && textParts.length === 0) {
      console.warn(`Command Code provider: dropped ${nonTextParts.length} non-text part(s) in user message`)
    }
    return textParts.map((p) => p.text).join("\n")
  }
  return ""
}

function convertToolResultOutput(output: LanguageModelV3ToolResultOutput): CCToolResultContent["output"] {
  switch (output.type) {
    case "text":
      return { type: "text", value: output.value }
    case "error-text":
      return { type: "error-text", value: output.value }
    case "json":
      return { type: "text", value: JSON.stringify(output.value) }
    case "execution-denied":
      return { type: "error-text", value: output.reason ?? "Execution denied" }
    case "error-json":
      return { type: "error-text", value: JSON.stringify(output.value) }
    case "content":
      return { type: "text", value: output.value.map((v: Record<string, unknown>) => ("text" in v ? v.text : JSON.stringify(v))).join("\n") }
    default:
      return { type: "text", value: JSON.stringify(output) }
  }
}

function convertMessage(msg: LanguageModelV3Message): CCMessage | null {
  switch (msg.role) {
    case "user": {
      const text = extractText(msg.content)
      return { role: "user", content: text }
    }
    case "assistant": {
      const parts: CCAssistantContent[] = []
      for (const part of msg.content) {
        if (isTextPart(part)) {
          parts.push({ type: "text", text: part.text })
        } else if (isReasoningPart(part)) {
          parts.push({ type: "reasoning", text: part.text })
        } else if (isToolCallPart(part)) {
          parts.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          })
        }
      }
      return { role: "assistant", content: parts }
    }
    case "tool": {
      const parts: CCToolResultContent[] = []
      for (const part of msg.content) {
        if (isToolResultPart(part)) {
          parts.push({
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: convertToolResultOutput(part.output),
          })
        }
      }
      return { role: "tool", content: parts }
    }
    default:
      return null
  }
}

function convertTools(
  tools: Array<LanguageModelV3FunctionTool | { type: "provider"; id: `${string}.${string}`; name: string; args: Record<string, unknown> }> | undefined,
): CCTool[] {
  if (!tools) return []
  return tools
    .filter((t): t is LanguageModelV3FunctionTool => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
}

export function buildRequest(
  modelId: string,
  options: LanguageModelV3CallOptions,
  context?: ProjectContext,
): CCRequestEnvelope {
  let systemPrompt = ""
  const messages: CCMessage[] = []

  for (const msg of options.prompt) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + msg.content
      continue
    }
    const converted = convertMessage(msg)
    if (converted) messages.push(converted)
  }

  const params: CCRequestEnvelope["params"] = {
    model: modelId,
    messages,
    tools: convertTools(options.tools),
    system: systemPrompt,
    max_tokens: options.maxOutputTokens ?? 16384,
    stream: true,
  }

  if (options.temperature !== undefined) params.temperature = options.temperature
  if (options.topP !== undefined) params.top_p = options.topP
  if (options.topK !== undefined) params.top_k = options.topK

  const opt = options as Record<string, unknown>
  const providerOpts =
    (opt.providerMetadata as Record<string, Record<string, unknown>> | undefined)?.commandcode ??
    (opt.providerOptions as Record<string, Record<string, unknown>> | undefined)?.commandcode

  if (providerOpts?.thinking) {
    params.thinking = providerOpts.thinking
  } else if (typeof opt.reasoningEffort === "string") {
    params.reasoning_effort = opt.reasoningEffort
  }

  return {
    config: {
      workingDir: process.cwd() ?? "/",
      date: new Date().toISOString().split("T")[0] ?? "",
      environment: `${process.platform}-${process.arch}`,
      structure: context?.structure ?? [],
      isGitRepo: context?.git.isGitRepo ?? false,
      currentBranch: context?.git.currentBranch ?? "",
      mainBranch: context?.git.mainBranch ?? "",
      gitStatus: context?.git.gitStatus ?? "",
      recentCommits: context?.git.recentCommits ?? [],
    },
    memory: "",
    taste: "",
    skills: null,
    permissionMode: "standard",
    params,
  }
}
