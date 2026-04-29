import type { ChatModelRunResult } from "@assistant-ui/react";

export class StreamQueue {
  private queue: string[] = [];
  private resolve: (() => void) | null = null;
  private done = false;
  private error: string | null = null;

  push(chunk: string) {
    this.queue.push(chunk);
    this.resolve?.();
    this.resolve = null;
  }

  finish() {
    this.done = true;
    this.resolve?.();
    this.resolve = null;
  }

  fail(error: string) {
    this.error = error;
    this.done = true;
    this.resolve?.();
    this.resolve = null;
  }

  async *generator(): AsyncGenerator<ChatModelRunResult> {
    while (!this.done || this.queue.length > 0) {
      if (this.queue.length === 0) {
        await new Promise<void>((r) => (this.resolve = r));
      }
      while (this.queue.length > 0) {
        yield { content: [{ type: "text" as const, text: this.queue.shift()! }] };
      }
    }
    if (this.error) throw new Error(this.error);
  }
}

const streamQueues = new Map<string, StreamQueue>();

export function createQueue(messageId: string): StreamQueue {
  const queue = new StreamQueue();
  streamQueues.set(messageId, queue);
  return queue;
}

export function getQueue(messageId: string): StreamQueue | undefined {
  return streamQueues.get(messageId);
}

export function removeQueue(messageId: string) {
  streamQueues.delete(messageId);
}
