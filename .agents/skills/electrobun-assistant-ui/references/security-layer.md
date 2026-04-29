# Security Layer: Prompt Injection & Output Sanitization

Use a local classification model (e.g., `hlyn/prompt-injection-judge-deberta-70m`) to gate all traffic between the user, LLM, tools, and external data. Because the main process sits in the middle of every data flow, it is the natural place for a security firewall.

## Architecture

```
User ──► [Input Guard] ──► LLM ──► [Output Guard] ──► Webview
              │                         │
              ▼                         ▼
           BLOCK                    BLOCK

Tool Result ──► [Tool Guard] ──► LLM Context
                     │
                     ▼
                  BLOCK
```

All guards run in the **Bun main process** so the model weights and logic never ship to the webview.

## Integration Points

There are exactly three hooks in `src/main.ts`:

1. **User input** — inside the `sendMessage` RPC handler, before `streamText`
2. **Tool results** — after any MCP tool executes, before the result is appended to `messages`
3. **External data** — after any fetch/external call, before the data enters the LLM context

## Minimal Security Layer

```ts
// src/security.ts
export interface SecurityResult {
  safe: boolean;
  score: number;
  reason?: string;
}

export class SecurityLayer {
  private threshold = 0.30;

  async checkUserInput(text: string): Promise<SecurityResult> {
    return this.classify(text);
  }

  async checkToolOutput(output: string): Promise<SecurityResult> {
    return this.classify(output);
  }

  async checkExternalData(data: string): Promise<SecurityResult> {
    return this.classify(data);
  }

  private async classify(text: string): Promise<SecurityResult> {
    // Delegate to inference backend (see options below)
    const score = await runInference(text);
    return {
      safe: score <= this.threshold,
      score,
      reason: score > this.threshold ? "Prompt injection or adversarial payload detected" : undefined,
    };
  }
}
```

## Wiring into the Main Process

```ts
// src/main.ts
import { SecurityLayer } from "./security";

const security = new SecurityLayer();

const chatRPC = BrowserView.defineRPC<ChatRPC>({
  handlers: {
    requests: {
      sendMessage: async ({ messages }) => {
        const lastUserMessage = messages[messages.length - 1];
        if (lastUserMessage?.role === "user") {
          const check = await security.checkUserInput(lastUserMessage.content);
          if (!check.safe) {
            // Stream a refusal instead of calling the LLM
            const messageId = crypto.randomUUID();
            queueMicrotask(() => {
              mainWindow.webview.rpc?.send.chatChunk({
                messageId,
                text: `🛡️ Blocked: ${check.reason}`,
              });
              mainWindow.webview.rpc?.send.chatDone({ messageId });
            });
            return { messageId };
          }
        }

        // ... existing streamText logic
      },
    },
    messages: {},
  },
});
```

## Inference Backends

Choose one based on your deployment constraints.

### Option A: Python Subprocess (Recommended — most reliable)

Bun spawns a long-running Python process that loads the ONNX model once and accepts lines of JSON via stdin.

**`scripts/guard.py`**

```python
import sys, json
from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForSequenceClassification
import torch

tokenizer = AutoTokenizer.from_pretrained("hlyn/prompt-injection-judge-deberta-70m")
tokenizer.truncation_side = "left"
model = ORTModelForSequenceClassification.from_pretrained(
    "hlyn/prompt-injection-judge-deberta-70m",
    file_name="model.onnx"
)

TEMPERATURE = 0.90
THRESHOLD = 0.30

def classify(text: str) -> float:
    inputs = tokenizer(
        [text], padding=True, truncation=True, max_length=512, return_tensors="pt"
    )
    logits = model(**inputs).logits
    scaled = logits / TEMPERATURE
    probs = torch.sigmoid(scaled[:, 1] - scaled[:, 0])
    return probs.item()

for line in sys.stdin:
    try:
        req = json.loads(line)
        score = classify(req["text"])
        print(json.dumps({ "score": score, "safe": score <= THRESHOLD }), flush=True)
    except Exception as e:
        print(json.dumps({ "error": str(e) }), flush=True)
```

**`src/security.ts`** (Python backend)

```ts
import { spawn } from "bun";

class PythonGuardBackend {
  private proc = spawn({
    cmd: ["python3", "scripts/guard.py"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  async classify(text: string): Promise<number> {
    const req = JSON.stringify({ text }) + "\n";
    this.proc.stdin.write(req);

    const reader = this.proc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();

    const line = new TextDecoder().decode(value).trim().split("\n").pop()!;
    const res = JSON.parse(line);
    if (res.error) throw new Error(res.error);
    return res.score;
  }
}
```

**Pros:** Full ONNX Runtime support, zero Bun/Node native-addon headaches.  
**Cons:** Requires Python 3.9+ and `onnxruntime` installed on the target machine.

### Option B: ONNX Runtime Node (if Bun compatibility allows)

```ts
import * as ort from "onnxruntime-node";

class OnnxGuardBackend {
  private session: ort.InferenceSession;

  async load(modelPath: string) {
    this.session = await ort.InferenceSession.create(modelPath);
  }

  async classify(text: string): Promise<number> {
    // Tokenization must be done separately (use a JS tokenizer or pre-tokenize in Python)
    // This path is more complex because you need input_ids, attention_mask in ONNX format
    // ...
    return score;
  }
}
```

**Pros:** Pure TypeScript, no Python dependency.  
**Cons:** Bun compatibility with `onnxruntime-node` native bindings is not guaranteed. Tokenization must be replicated in JS or pre-computed.

### Option C: HuggingFace API / Hosted Endpoint

If local inference is not required, proxy to a hosted version of the model.

```ts
class ApiGuardBackend {
  async classify(text: string): Promise<number> {
    const res = await fetch("https://your-guard-api.internal/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    return data.score;
  }
}
```

**Pros:** Simplest code, easy to update models.  
**Cons:** Requires network, latency, privacy concerns.

## Guarding MCP Tool Results

If you integrate MCP (Model Context Protocol) tools, wrap each tool call:

```ts
async function executeToolSafely(toolCall: ToolCall, security: SecurityLayer) {
  const rawResult = await mcpClient.callTool(toolCall.name, toolCall.args);

  const check = await security.checkToolOutput(JSON.stringify(rawResult));
  if (!check.safe) {
    return { error: `Tool result blocked: ${check.reason}` };
  }

  return rawResult;
}
```

Then inject the (sanitized) result into the LLM message list as a `tool` message.

## Guarding External Answers

For RAG, web search, or any external fetch:

```ts
const searchResults = await fetchWebSearch(query);
for (const result of searchResults) {
  const check = await security.checkExternalData(result.snippet);
  if (!check.safe) {
    result.snippet = "[Content removed by security policy]";
  }
}
```

## Threshold Tuning

| Threshold | Behavior |
|-----------|----------|
| `0.30` | High precision, fewer false positives, fail-open (default) |
| `0.50` | Balanced |
| `0.70` | High recall, blocks more edge cases, more false positives |

For **user input** guarding, prefer high precision (0.30) so legitimate prompts are not blocked.  
For **tool output** guarding in high-risk scenarios, you might prefer high recall (0.50–0.70).

## Thread Safety

The Python subprocess backend above uses a single process with stdin/stdout. If you need concurrent classification, either:

1. Maintain a pool of 2–4 Python processes, round-robin requests
2. Queue requests in Bun and process sequentially

For a desktop chat app, sequential guarding is usually sufficient (~100ms per check).
