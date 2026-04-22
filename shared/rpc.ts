// RPC type definitions for main process <-> webview communication
// This file defines the contract for typed RPC between Electrobun main and webview

import type { RPCSchema } from "electrobun";

export type MainRPC = {
	bun: RPCSchema<{
		requests: {
			ping: {
				params: Record<string, never>;
				response: string;
			};
			getGreeting: {
				params: Record<string, never>;
				response: string;
			};
		};
		messages: {
			log: { msg: string };
		};
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: Record<string, never>;
	}>;
};
