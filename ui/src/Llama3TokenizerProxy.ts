let worker: Worker | null = null;

async function initializeWorker() {
	if (!worker) {
		const { default: Worker } = await import("./llama3Tokenizer.js?worker");
		console.log("Llama3Tokenizer worker loaded");
		worker = new Worker();
	}
}

export function useWorker(text: string) {
	void initializeWorker();
	if (worker) {
		worker.postMessage(text);
	} else {
		console.log("Worker not initialized yet");
	}
}

export async function tokenizeString(text: string): Promise<{ resultText: string; resultTokens: string[] }> {
	await initializeWorker();

	if (!worker) {
		throw new Error("Worker not initialized yet");
	}

	const activeWorker = worker;

	return new Promise((resolve) => {
		function handleWorkerMessage(event: { data: { resultText: string; resultTokens: string[] } }) {
			const { resultText, resultTokens } = event.data;

			if (resultText === text) {
				activeWorker.removeEventListener("message", handleWorkerMessage);
				resolve({ resultText, resultTokens });
			}
		}

		activeWorker.addEventListener("message", handleWorkerMessage);
		activeWorker.postMessage(text);
	});
}

void initializeWorker();
