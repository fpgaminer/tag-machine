import React, { useEffect, useState, useRef, useMemo } from "react";
import { addImageAttribute, imageIdToUrl } from "./state";
import SaveButton from "./SaveButton";
import { GoogleGenerativeAI, GenerationConfig, SafetySetting } from "@google/generative-ai";
import { authenticatedFetch } from "./api";

interface QuestionAnswer {
	question: string;
	answer: string;
}

function VQAEditor({ imageId, imageQA }: { imageId: number; imageQA: string | null }) {
	const parsedQA = useMemo(() => (imageQA === null ? null : (JSON.parse(imageQA) as QuestionAnswer)), [imageQA]);
	const [localQA, setLocalQA] = useState<QuestionAnswer>(parsedQA ?? { question: "", answer: "" });
	const localStorageCaption = useMemo(() => getLocalStorageVQA(imageId), [imageId]);
	const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
	const answerTextareaRef = useRef<HTMLTextAreaElement>(null);

	// Update the question and answer when the image changes
	useEffect(() => {
		setLocalQA(localStorageCaption ?? parsedQA ?? { question: "", answer: "" });
	}, [parsedQA, localStorageCaption]);

	const isUnsaved = localQA.question !== parsedQA?.question || localQA.answer !== parsedQA?.answer;

	async function handleSave() {
		await addImageAttribute(imageId, "questionAnswer", JSON.stringify(localQA), true);

		// Clear the local storage
		clearLocalStorageVQA(imageId);
	}

	function onRevertClicked() {
		// Revert to the server's version of the question and answer
		setLocalQA(parsedQA ?? { question: "", answer: "" });
		clearLocalStorageVQA(imageId);
	}

	function onQuestionChanged(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setLocalQA((prevQA) => ({ ...prevQA, question: e.target.value }));
		saveLocalStorageVQA(imageId, { ...localQA, question: e.target.value });
	}

	function onAnswerChanged(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setLocalQA((prevQA) => ({ ...prevQA, answer: e.target.value }));
		saveLocalStorageVQA(imageId, { ...localQA, answer: e.target.value });
	}

	async function onGeminiClicked() {
		const { systemInstruction, safetySettings } = await getGeminiSettings();
		if (systemInstruction === null || safetySettings === null) {
			return;
		}

		console.log("Running Gemini with system instruction:", systemInstruction, "and safety settings:", safetySettings);

		const question = localQA.question;
		const response = await doGemini(systemInstruction, safetySettings, imageId, question, null);
		if (response === null) {
			return;
		}

		setLocalQA({ ...localQA, answer: response });
	}

	async function onSuggestClicked() {
		let genPrompt = localStorage.getItem("GEMINI_GEN_VQA_QUESTIONS_PROMPT");
		if (genPrompt === null) {
			genPrompt = await asyncPrompt("Enter gen prompt");
			if (genPrompt === null) {
				return;
			}
			localStorage.setItem("GEMINI_GEN_VQA_QUESTIONS_PROMPT", genPrompt);
		}

		const { systemInstruction, safetySettings } = await getGeminiSettings();
		if (systemInstruction === null || safetySettings === null) {
			return;
		}

		console.log(
			"Running Gemini with system instruction:",
			systemInstruction,
			"and safety settings:",
			safetySettings,
			"and gen prompt:",
			genPrompt,
		);

		const response = await doGemini(systemInstruction, safetySettings, imageId, genPrompt, {
			type: "object",
			properties: {
				prompts: {
					type: "array",
					items: {
						type: "string",
					},
				},
			},
			required: ["prompts"],
		});
		if (response === null) {
			return;
		}

		const jsonResponse = JSON.parse(response) as { prompts: string[] };
		setSuggestedPrompts(jsonResponse.prompts);
	}

	async function onCustomClicked() {
		const response = await doCustom(imageId, "");
		if (response === null) {
			return;
		}

		setLocalQA({ ...localQA, question: response });
	}

	function onPromptSelected(prompt: string) {
		setLocalQA({ ...localQA, question: prompt });
		setSuggestedPrompts(null);
		answerTextareaRef.current?.focus();
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Visual Q & A</h3>
				<div className="columnHeaderButtons">
					<button onClick={onCustomClicked}>Custom</button>
					<button onClick={onSuggestClicked}>Suggest</button>
					<button onClick={onGeminiClicked}>Run Gemini</button>
					<button onClick={onRevertClicked} disabled={!isUnsaved}>
						Revert
					</button>
					<SaveButton isUnsaved={isUnsaved} onSave={handleSave} />
				</div>
			</div>
			{suggestedPrompts && (
				<div className="suggested-prompts">
					<h4>Select a Prompt:</h4>
					<ul>
						{suggestedPrompts.map((prompt, index) => (
							<li key={index} onClick={() => onPromptSelected(prompt)}>
								{prompt}
							</li>
						))}
					</ul>
				</div>
			)}
			<div className="remainingSpace vqaEditor">
				<textarea placeholder="Enter your question" value={localQA.question} onChange={onQuestionChanged} />
				<textarea
					ref={answerTextareaRef}
					placeholder="Enter the answer"
					value={localQA.answer}
					onChange={onAnswerChanged}
				/>
			</div>
		</div>
	);
}

function saveLocalStorageVQA(imageId: number, qa: QuestionAnswer) {
	const k = `useVQAEdits-${imageId}`;
	localStorage.setItem(k, JSON.stringify(qa));
}

function clearLocalStorageVQA(imageId: number) {
	const k = `useVQAEdits-${imageId}`;
	localStorage.removeItem(k);
}

function getLocalStorageVQA(imageId: number): QuestionAnswer | null {
	const k = `useVQAEdits-${imageId}`;
	const v = localStorage.getItem(k);
	if (v === null) {
		return null;
	}
	return JSON.parse(v) as QuestionAnswer;
}

export default VQAEditor;

async function getImageAsBase64(imageId: number): Promise<{ base64: string; mimeType: string }> {
	const response = await authenticatedFetch(imageIdToUrl(imageId));
	if (!response.ok) {
		throw new Error(`Failed to fetch image: ${response.statusText}`);
	}

	const mimeType = response.headers.get("Content-Type") ?? "image/jpeg";
	const blob = await response.blob();

	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const base64data = reader.result?.toString().split(",")[1] ?? "";
			resolve({ base64: base64data, mimeType });
		};
		reader.onerror = (err) => reject(err);
		reader.readAsDataURL(blob);
	});
}

function asyncPrompt(message: string): Promise<string | null> {
	return new Promise((resolve) => {
		const result = prompt(message);
		resolve(result);
	});
}

async function getGeminiSettings(): Promise<{
	systemInstruction: string | null;
	safetySettings: SafetySetting[] | null;
}> {
	let systemInstruction = localStorage.getItem("GEMINI_SYSTEM_INSTRUCTION");
	if (systemInstruction === null) {
		systemInstruction = await asyncPrompt("Enter system instruction");
		if (systemInstruction === null) {
			return { systemInstruction: null, safetySettings: null };
		}
		localStorage.setItem("GEMINI_SYSTEM_INSTRUCTION", systemInstruction);
	}

	let safetySettingsJson = localStorage.getItem("GEMINI_SAFETY_SETTINGS");
	if (safetySettingsJson === null) {
		safetySettingsJson = await asyncPrompt("Enter safety settings");
		if (safetySettingsJson === null) {
			return { systemInstruction: null, safetySettings: null };
		}
		localStorage.setItem("GEMINI_SAFETY_SETTINGS", safetySettingsJson);
	}

	const safetySettings = JSON.parse(safetySettingsJson) as SafetySetting[];

	return { systemInstruction, safetySettings };
}

async function doGemini(
	systemInstruction: string,
	safetySettings: SafetySetting[],
	imageId: number,
	question: string,
	responseSchema: object | null,
): Promise<string | null> {
	try {
		let apiKey = localStorage.getItem("GEMINI_API_KEY");
		if (apiKey === null) {
			apiKey = await asyncPrompt("Enter API key");
			if (apiKey === null) {
				return null;
			}
			localStorage.setItem("GEMINI_API_KEY", apiKey);
		}

		const generationConfig = {
			temperature: 1,
			topP: 0.95,
			topK: 40,
			maxOutputTokens: 512,
			responseMimeType: "text/plain",
		} as GenerationConfig;

		if (responseSchema !== null) {
			generationConfig.responseSchema = responseSchema;
			generationConfig.responseMimeType = "application/json";
		}

		const imageBase64 = await getImageAsBase64(imageId);
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({
			model: "gemini-1.5-pro-002",
			safetySettings,
			generationConfig,
			systemInstruction,
		});
		const imageArg = {
			inlineData: {
				data: imageBase64.base64,
				mimeType: imageBase64.mimeType,
			},
		};

		const result = await model.generateContent([question, imageArg]);

		return result.response.text();
	} catch (e) {
		alert(`Error running Gemini: ${e}`);
		return "";
	}
}

async function doCustom(image_id: number, prompt: string): Promise<string | null> {
	try {
		const response = await fetch("http://127.0.0.1:5028/predict", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ prompt, image_id }),
		});

		const json = (await response.json()) as { output: string };
		return json.output;
	} catch (e) {
		alert(`Error running custom model: ${e}`);
		return "";
	}
}
