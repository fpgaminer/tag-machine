let worker: Worker | null = null;

async function initializeWorker() {
	if (!worker) {
		const { default: Worker } = await import("./llama3Tokenizer.js?worker");
		console.log("Llama3Tokenizer worker loaded");
		worker = new Worker();
	}
}

export function useWorker(text: string) {
	initializeWorker();
	if (worker) {
		worker.postMessage(text);
	} else {
		console.log("Worker not initialized yet");
	}
}

export function tokenizeString(text: string): Promise<{ resultText: string; resultTokens: string[]; }> {
	return new Promise((resolve, reject) => {
		initializeWorker();

		function handleWorkerMessage(event: { data: { resultText: string; resultTokens: string[]; }; }) {
			const { resultText, resultTokens } = event.data;

			if (resultText === text) {
				worker?.removeEventListener("message", handleWorkerMessage);
				resolve({ resultText, resultTokens });
			}
		}

		if (worker) {
			worker.addEventListener("message", handleWorkerMessage);
			worker.postMessage(text);
		} else {
			reject("Worker not initialized yet");
		}
	});
}

initializeWorker();