import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";

export function Chat() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto p-4 space-y-4">
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <div
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-100"
                }`}
              >
                <MessagePrimitive.Content />
              </div>
            </div>
          )}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
      <div className="border-t border-neutral-800 p-4">
        <ComposerPrimitive.Root className="flex gap-2">
          <ComposerPrimitive.Input
            className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-neutral-100 outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Type a message..."
          />
          <ComposerPrimitive.Send className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Send
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
