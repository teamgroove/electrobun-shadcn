import { useState, useEffect, useRef, useCallback } from "react";
import { electrobun } from "../electrobun";

export function Terminal() {
  const [screen, setScreen] = useState("Loading...");
  const [input, setInput] = useState("");
  const screenRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.screen) setScreen(detail.screen);
    };
    window.addEventListener("terminal-screen-update", handler);
    return () => window.removeEventListener("terminal-screen-update", handler);
  }, []);

  const send = useCallback(async () => {
    if (!input) return;
    await electrobun.rpc?.request.writeVT({ data: input + "\r\n" });
    setInput("");
  }, [input]);

  const sendRaw = useCallback(async (data: string) => {
    await electrobun.rpc?.request.writeVT({ data });
  }, []);

  return (
    <div className="flex h-full flex-col p-4 gap-4">
      <div className="text-sm text-neutral-400">
        Ghostty VT Terminal (via WASM in Bun main process)
      </div>

      <pre
        ref={screenRef}
        className="flex-1 overflow-auto rounded-lg bg-neutral-900 p-4 text-sm leading-relaxed whitespace-pre-wrap border border-neutral-800"
      >
        {screen}
      </pre>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type text or VT sequences..."
          className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-neutral-100 outline-none border border-neutral-800 focus:border-blue-500"
        />
        <button
          onClick={send}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Send
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <DemoButton onClick={() => sendRaw("\x1b[2J\x1b[H")} label="Clear" />
        <DemoButton onClick={() => sendRaw("\x1b[1;31mRed\x1b[0m \x1b[1;32mGreen\x1b[0m \x1b[1;34mBlue\x1b[0m\r\n")} label="Colors" />
        <DemoButton onClick={() => sendRaw("\x1b[1mBold\x1b[0m \x1b[4mUnderline\x1b[0m\r\n")} label="Styles" />
        <DemoButton onClick={() => sendRaw("Line 1\r\nLine 2\r\nLine 3\r\n")} label="Lines" />
      </div>
    </div>
  );
}

function DemoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 border border-neutral-700"
    >
      {label}
    </button>
  );
}
