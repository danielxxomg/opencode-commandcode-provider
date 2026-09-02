import { expect, test } from "bun:test"
import v2Plugin, { id } from "../../v2.ts"

test("v2 export has correct id and setup function", () => {
  expect(id).toBe("commandcode-go-opencode-provider")
  expect(v2Plugin.id).toBe("commandcode-go-opencode-provider")
  expect(typeof v2Plugin.setup).toBe("function")
})

test("v2 setup registers provider and model catalog via transform", async () => {
  const providerUpdates: Record<string, Record<string, unknown>> = {}
  const modelUpdates: Record<string, Record<string, unknown>> = {}

  const mockContext = {
    catalog: {
      transform: async (fn: (catalog: any) => void | Promise<void>) => {
        const catalogDraft = {
          provider: {
            update: (providerID: string, updateFn: (draft: Record<string, unknown>) => void) => {
              const draft: Record<string, unknown> = {}
              updateFn(draft)
              providerUpdates[providerID] = draft
            },
          },
          model: {
            update: (providerID: string, modelKey: string, updateFn: (draft: Record<string, unknown>) => void) => {
              const draft: Record<string, unknown> = {}
              updateFn(draft)
              modelUpdates[`${providerID}:${modelKey}`] = draft
            },
          },
        }
        await fn(catalogDraft)
      },
    },
  }

  await v2Plugin.setup(mockContext as any)

  expect(providerUpdates["commandcode"]).toBeDefined()
  expect(providerUpdates["commandcode"].name).toBe("Command Code")
  expect(providerUpdates["commandcode"].package).toBe("aisdk:commandcode-go-opencode-provider")

  expect(Object.keys(modelUpdates).length).toBeGreaterThanOrEqual(50)
  const sampleModel = modelUpdates["commandcode:deepseek-v4-flash"]
  expect(sampleModel).toBeDefined()
  expect(sampleModel.modelID).toBe("deepseek/deepseek-v4-flash")
  expect(sampleModel.capabilities).toBeDefined()
  expect(sampleModel.limit).toBeDefined()
})
