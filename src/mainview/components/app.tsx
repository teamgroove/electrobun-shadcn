import { electrobun } from "@/lib/electrobun";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

export function App() {
	const [greeting, setGreeting] = useState<string>("Loading...");

	useEffect(() => {
		electrobun.rpc?.request.getGreeting({}).then((response) => {
			setGreeting(response);
		});
	}, []);

	return (
		<div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
			<h1 className="text-4xl font-bold">{greeting}</h1>
			<p className="text-muted-foreground">
				Electrobun + React + Vite + Tailwind CSS 4 + shadcn/ui.
			</p>
			<div className="flex gap-4">
				<Button>Yo, huhu, fast, Primary Button</Button>
				<Button variant="secondary">Secondary</Button>
				<Button variant="outline">Outline</Button>
				<Button variant="ghost">Ghost</Button>
			</div>
		</div>
	);
}
