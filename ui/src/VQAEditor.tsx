import { observer } from "mobx-react";
import { currentImageState } from "./state/CurrentImage";
import React, { useEffect, useState, useRef } from "react";
import { autorun } from "mobx";
import { addImageAttribute, imageHashToUrl, ImageObject } from "./state";
import SaveButton from "./SaveButton";
import { GoogleGenerativeAI, GenerationConfig, SafetySetting } from "@google/generative-ai";
import { authenticatedFetch } from "./api";

interface QuestionAnswer {
	question: string;
	answer: string;
}

function VQAEditor() {
	const image = currentImageState.image;
	const imageRawQA = image !== null ? image.flatAttributes.get("questionAnswer") ?? null : null;
	const imageQA = imageRawQA !== null ? JSON.parse(imageRawQA[0]) as QuestionAnswer : null;
	const [localQA, setLocalQA] = useState<QuestionAnswer>(imageQA ?? { question: "", answer: "" });
	const localStorageCaption = (image !== null) ? getLocalStorageVQA(image.id) : null;
	const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
	const answerTextareaRef = useRef<HTMLTextAreaElement>(null);

	// Update the question and answer when the image changes
	useEffect(
		() =>
			autorun(() => {
				if (image === null) {
					return;
				}

				setLocalQA(localStorageCaption ?? imageQA ?? { question: "", answer: "" });
			}),
		[image]
	);

	const isUnsaved = localQA.question !== imageQA?.question || localQA.answer !== imageQA?.answer;

	async function handleSave() {
		if (image === null) {
			console.error("No image selected, cannot save question and answer");
			return;
		}

		await addImageAttribute(image, "questionAnswer", JSON.stringify(localQA), true);

		// Clear the local storage
		clearLocalStorageVQA(image.id);
	}

	function onRevertClicked() {
		// Revert to the server's version of the question and answer
		setLocalQA(imageQA ?? { question: "", answer: "" });
		clearLocalStorageVQA(image?.id ?? -1);
	}

	function onQuestionChanged(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setLocalQA({ ...localQA, question: e.target.value });
		if (image !== null) {
			saveLocalStorageVQA(image.id, { ...localQA, question: e.target.value });
		}
	}

	function onAnswerChanged(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setLocalQA({ ...localQA, answer: e.target.value });
		if (image !== null) {
			saveLocalStorageVQA(image.id, { ...localQA, answer: e.target.value });
		}
	}

	async function onGeminiClicked() {
		if (image === null) {
			console.error("No image selected, cannot run Gemini");
			return;
		}

		let { systemInstruction, safetySettings } = await getGeminiSettings();
		if (systemInstruction === null || safetySettings === null) {
			return;
		}

		console.log("Running Gemini with system instruction:", systemInstruction, "and safety settings:", safetySettings);

		const question = localQA.question;
		const response = await doGemini(systemInstruction, safetySettings, image, question, null);
		if (response === null) {
			return;
		}

		setLocalQA({ ...localQA, answer: response });
	}

	async function onSuggestClicked() {
		if (image === null) {
			console.error("No image selected, cannot suggest prompts");
			return;
		}

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

		console.log("Running Gemini with system instruction:", systemInstruction, "and safety settings:", safetySettings, "and gen prompt:", genPrompt);

		const response = await doGemini(systemInstruction, safetySettings, image, genPrompt, {
			type: "object",
			properties: {
				prompts: {
				type: "array",
				items: {
					type: "string"
				}
				}
			},
			required: [
				"prompts"
			]
		});
		if (response === null) {
			return;
		}

		const jsonResponse = JSON.parse(response);
		setSuggestedPrompts(jsonResponse.prompts);
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
					<button onClick={onSuggestClicked}>Suggest</button>
					<button onClick={onGeminiClicked}>Run Gemini</button>
					<button onClick={onRevertClicked} disabled={!isUnsaved}>Revert</button>
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
				<textarea
					placeholder="Enter your question"
					value={localQA.question}
					onChange={onQuestionChanged}
				/>
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

export default observer(VQAEditor);


async function getImageAsBase64(image: ImageObject): Promise<{ base64: string, mimeType: string }> {
	const response = await authenticatedFetch(imageHashToUrl(image.hash));
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


async function getGeminiSettings(): Promise<{ systemInstruction: string | null, safetySettings: SafetySetting[] | null }> {
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


async function doGemini(systemInstruction: string, safetySettings: SafetySetting[], image: ImageObject, question: string, responseSchema: object | null): Promise<string | null> {
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

		const imageBase64 = await getImageAsBase64(image);
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-002", safetySettings, generationConfig, systemInstruction });
		const imageArg = {
			inlineData: {
				data: imageBase64.base64,
				mimeType: imageBase64.mimeType,
			}
		};

		const result = await model.generateContent([question, imageArg]);

		return result.response.text();
	} catch (e) {
		alert(`Error running Gemini: ${e}`);
		return "";
	}
}