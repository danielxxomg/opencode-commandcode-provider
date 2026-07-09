# commandcode-go-opencode-provider

[Command Code](https://commandcode.ai) API provider for [opencode](https://opencode.ai). Use Claude, GPT, Gemini, DeepSeek, Qwen, Kimi, GLM, MiniMax, Step, and other models through a single API key.

> **This fork** adds production-grade retry/backoff, SSE error propagation, and
> key rotation on top of the [original by @brent-weatherall](https://github.com/brent-weatherall/opencode-commandcode-provider).

## What this fork adds

- **Retry with jitter**: fixed backoff schedule `[1s, 2.5s, 5s]` with +-25% jitter replaces unbounded exponential growth.
- **Error classification**: 18 non-retryable patterns (auth/quota/validation) and 24 retryable patterns (network/server/timeout).
- **Mid-stream reconnect**: `emittedContent` tracking prevents duplicate content on reconnect.
- **SSE error propagation**: SSE error events terminate the stream via `controller.error()` instead of being silently swallowed.
- **Partial output safety**: aborts reconnect when text/tool-calls were already emitted to prevent duplicates.

## Quick Start

### 1. Install from this fork

```bash
git clone https://github.com/danielxxomg/opencode-commandcode-provider.git
cd opencode-commandcode-provider
bun install
```

### 2. Register in OpenCode

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["commandcode-go-opencode-provider/server"],
  "provider": {
    "commandcode": {
      "npm": "commandcode-go-opencode-provider",
      "name": "Command Code",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

Or use the local file path if you don't want to publish to npm:

```json
{
  "plugin": ["file:///path/to/opencode-commandcode-provider/plugin.ts"],
  "provider": {
    "commandcode": {
      "npm": "file:///path/to/opencode-commandcode-provider",
      "name": "Command Code (local)",
      "env": ["COMMANDCODE_API_KEY"]
    }
  }
}
```

### 3. Connect

Run `/connect` in opencode, search for **Command Code**, and enter your API key:

```
/connect
```

Or set the environment variable:

```bash
COMMANDCODE_API_KEY=your-key opencode
```

### 4. Select a model

```
/models
```

## Available Models

| Model ID | Name | Tier | Reasoning | Context |
|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | premium | no | 200K |
| `claude-opus-4-7` | Claude Opus 4.7 | premium | yes | 1M |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | premium | yes | 1M |
| `gpt-5.3-codex` | GPT-5.3 Codex | premium | yes | 400K |
| `gpt-5.4` | GPT-5.4 | premium | yes | 400K |
| `gpt-5.4-mini` | GPT-5.4 Mini | premium | yes | 400K |
| `gpt-5.5` | GPT-5.5 | premium | yes | 256K |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | open-source | yes | 1M |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | open-source | yes | 1M |
| `google/gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | open-source | yes | 1M |
| `google/gemini-3.5-flash` | Gemini 3.5 Flash | open-source | yes | 1M |
| `zai-org/GLM-5` | GLM-5 | open-source | no | 200K |
| `zai-org/GLM-5.1` | GLM-5.1 | open-source | no | 200K |
| `moonshotai/Kimi-K2.5` | Kimi K2.5 | open-source | no | 256K |
| `moonshotai/Kimi-K2.6` | Kimi K2.6 | open-source | no | 256K |
| `MiniMaxAI/MiniMax-M2.5` | MiniMax M2.5 | open-source | no | 200K |
| `MiniMaxAI/MiniMax-M2.7` | MiniMax M2.7 | open-source | no | 1M |
| `Qwen/Qwen3.6-Max-Preview` | Qwen 3.6 Max Preview | open-source | yes | 1M |
| `Qwen/Qwen3.6-Plus` | Qwen 3.6 Plus | open-source | yes | 1M |
| `Qwen/Qwen3.7-Max` | Qwen 3.7 Max | open-source | yes | 1M |
| `stepfun/Step-3.5-Flash` | Step 3.5 Flash | open-source | yes | 1M |

Full model list is maintained in [`models.json`](./models.json). Run `bun run sync` to refresh from the latest Command Code CLI release on npm.

## Development

```bash
git clone https://github.com/danielxxomg/opencode-commandcode-provider.git
cd opencode-commandcode-provider
bun install
bun test
```

### Sync Models

```bash
bun run sync              # update models.json from Command Code
bun run sync:global       # update models.json + write to ~/.config/opencode/opencode.jsonc
```

## License

MIT
