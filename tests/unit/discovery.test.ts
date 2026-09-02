import { expect, test } from "bun:test"
import {
  fetchModelsFromApi,
  mergeModels,
  type ModelEntry,
  type ApiModel,
} from "../../src/models.js"

const baseModel: ModelEntry = {
  id: "test/local-model",
  name: "Local Model",
  tier: "open-source",
  reasoning: false,
  tool_call: true,
  cost: { input: 1, output: 2 },
  limit: { context: 100000, output: 4096 },
}

test("mergeModels updates context limit for existing models", () => {
  const apiModels: ApiModel[] = [{ id: "test/local-model", context_length: 500000 }]
  const merged = mergeModels([baseModel], apiModels)

  expect(merged).toHaveLength(1)
  expect(merged[0].limit.context).toBe(500000)
  expect(merged[0].name).toBe("Local Model")
  expect(merged[0].cost.input).toBe(1)
})

test("mergeModels dynamically adds newly discovered API models", () => {
  const apiModels: ApiModel[] = [
    { id: "test/local-model" },
    { id: "new-vendor/future-reasoning-model", name: "Future Reasoning Model", context_length: 2000000 },
  ]
  const merged = mergeModels([baseModel], apiModels)

  expect(merged).toHaveLength(2)
  const newModel = merged.find((m) => m.id === "new-vendor/future-reasoning-model")
  expect(newModel).toBeDefined()
  expect(newModel?.name).toBe("Future Reasoning Model")
  expect(newModel?.tier).toBe("open-source")
  expect(newModel?.reasoning).toBe(true)
  expect(newModel?.limit.context).toBe(2000000)
  expect(newModel?.tool_call).toBe(true)
})

test("fetchModelsFromApi returns null when API request fails or throws", async () => {
  const mockFailingFetch = async () => {
    throw new Error("Network down")
  }

  const result = await fetchModelsFromApi(undefined, mockFailingFetch as unknown as typeof fetch)
  expect(result).toBeNull()
})

test("fetchModelsFromApi parses API models and sends authorization header if present", async () => {
  let capturedHeaders: Record<string, string> = {}
  const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>
    return {
      ok: true,
      json: async () => ({
        data: [{ id: "test/api-model", context_length: 128000 }],
      }),
    } as unknown as Response
  }

  const result = await fetchModelsFromApi("sk-my-key", mockFetch as unknown as typeof fetch)
  expect(result).toEqual([{ id: "test/api-model", context_length: 128000 }])
  expect(capturedHeaders["Authorization"]).toBe("Bearer sk-my-key")
})

test("fetchModelsFromApi works without API key (public endpoint)", async () => {
  let capturedHeaders: Record<string, string> = {}
  const originalEnv = process.env.COMMANDCODE_API_KEY
  delete process.env.COMMANDCODE_API_KEY

  try {
    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>
      return {
        ok: true,
        json: async () => ({
          data: [{ id: "test/public-model", context_length: 64000 }],
        }),
      } as unknown as Response
    }

    const result = await fetchModelsFromApi(undefined, mockFetch as unknown as typeof fetch)
    expect(result).toEqual([{ id: "test/public-model", context_length: 64000 }])
    expect(capturedHeaders["Authorization"]).toBeUndefined()
  } finally {
    if (originalEnv) process.env.COMMANDCODE_API_KEY = originalEnv
  }
})
