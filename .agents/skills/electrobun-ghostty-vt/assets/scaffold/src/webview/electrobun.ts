import Electrobun, { Electroview } from "electrobun/view";
import type { TerminalRPC } from "../rpc";

const rpc = Electroview.defineRPC<TerminalRPC>({
  maxRequestTime: 30000,
  handlers: {
    requests: {},
    messages: {
      screenUpdated: ({ screen }) => {
        window.dispatchEvent(
          new CustomEvent("terminal-screen-update", { detail: { screen } })
        );
      },
    },
  },
});

export const electrobun = new Electrobun.Electroview({ rpc });
