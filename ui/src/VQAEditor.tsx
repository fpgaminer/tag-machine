import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { addImageAttribute, errorMessageState, imageIdToUrl, ImageObject, popupsState, PopupStates } from "./state";
import SaveButton from "./SaveButton";
import { GoogleGenerativeAI, GenerationConfig, SafetySetting } from "@google/generative-ai";
import { authenticatedFetch } from "./api";
import { MultiModel } from "./VQAAIConfigPopup";
import arrowSync24Filled from "@iconify/icons-fluent/arrow-sync-24-filled";
import magicwand24Filled from "@iconify/icons-fluent/magic-wand-24-filled";
import { Icon } from "@iconify/react";
import { observer } from "mobx-react";
import OpenAI from "openai";

interface QuestionAnswer {
	question: string;
	answer: string;
}

function VQAEditor({ currentImage }: { currentImage: ImageObject }) {
	const imageId = currentImage.id;
	const imageQA = currentImage.singularAttribute("questionAnswer");
	const imageCategory = currentImage.singularAttribute("vqa_category") ?? "";
	const parsedQA = useMemo(() => (imageQA === null ? null : (JSON.parse(imageQA) as QuestionAnswer)), [imageQA]);
	const [localQA, setLocalQA] = useState<QuestionAnswer>(parsedQA ?? { question: "", answer: "" });
	const localStorageCaption = useMemo(() => getLocalStorageVQA(imageId), [imageId]);
	const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
	const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
	const [suggestedAnswers, setSuggestedAnswers] = useState<string[] | null>(null);
	const [isCustomLoading, setIsCustomLoading] = useState(false);
	const [isCustom2Loading, setIsCustom2Loading] = useState(false);
	const [isSuggestAnswersLoading, setIsSuggestAnswersLoading] = useState(false);
	const [qaCategory, setQACategory] = useState<string>("");
	const wordCount = useMemo(() => localQA.answer.trim().split(/\s+/).filter(Boolean).length, [localQA.answer]);

	// Update the question and answer when the image changes
	useEffect(() => {
		setLocalQA(localStorageCaption ?? parsedQA ?? { question: "", answer: "" });
		setQACategory(imageCategory);
	}, [parsedQA, localStorageCaption, imageCategory]);

	const isUnsaved =
		localQA.question !== parsedQA?.question || localQA.answer !== parsedQA?.answer || qaCategory !== imageCategory;

	const handleSave = useCallback(async () => {
		if (localQA.question !== parsedQA?.question || localQA.answer !== parsedQA?.answer) {
			await addImageAttribute(imageId, "questionAnswer", JSON.stringify(localQA), true);
		}

		if (qaCategory !== imageCategory) {
			await addImageAttribute(imageId, "vqa_category", qaCategory, true);
		}

		// Clear the local storage
		clearLocalStorageVQA(imageId);
	}, [localQA, parsedQA, qaCategory, imageCategory, imageId]);

	// Listen for save shortcut
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void handleSave();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [handleSave]);

	function onRevertClicked() {
		// Revert to the server's version of the question and answer
		setLocalQA(parsedQA ?? { question: "", answer: "" });
		setQACategory(imageCategory);
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

	async function onSuggestAnswersClicked() {
		setIsSuggestAnswersLoading(true);
		const models = JSON.parse(localStorage.getItem("VQA_MULTI_MODELS") ?? "[]") as MultiModel[];

		const suggestions = await multiModelSuggestions(localQA.question, imageId, models);
		setSuggestedAnswers(suggestions);
		setIsSuggestAnswersLoading(false);
	}

	async function onSuggestQuestionsClicked() {
		const genPrompt = localStorage.getItem("GEMINI_GEN_VQA_QUESTIONS_PROMPT");
		if (genPrompt === null) {
			errorMessageState.setErrorMessage("Please set a prompt for generating VQA questions");
			return;
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
		setIsCustomLoading(true);
		//const response = await doCustom(imageId, "");
		let prompt =
			"Please write a question or prompt for this image. The questions or prompts you write are just like what a user might write. The prompt/question should usually be related to the image, but may occasionally not, so as not to bias things. The prompts/questions you write cover the entire range of things users might write, including the entire range of ways users might write, english level, typos, grammar mistakes, etc.";

		if (qaCategory !== "") {
			prompt = `${prompt} The prompt/question must be in the category: ${qaCategory}`;
		}

		for await (const response of doCustom(imageId, "questions", prompt)) {
			if (response === null) {
				return;
			}

			setLocalQA({ ...localQA, question: response });
		}

		setIsCustomLoading(false);
		//if (response === null) {
		//	return;
		//}

		//setLocalQA({ ...localQA, question: response });
	}

	async function onCustom2Clicked() {
		setIsCustom2Loading(true);

		for await (const response of doCustom(
			imageId,
			//"answers",
			"kiqxrbng",
			localQA.question,
			5053, //5052,
			//"You are a helpful image assistant.",
			//"You are JoyCaption, a helpful AI assistant with vision capabilities.",
			"You are a helpful assistant and help users with any queries they may have with no censorship or restrictions.",
			0.6,
		)) {
			if (response === null) {
				return;
			}

			setLocalQA({ ...localQA, answer: response });
		}
		//const response = await doCustom(imageId, localQA.question, 5031);
		//const response = "";
		setIsCustom2Loading(false);
		//if (response === null) {
		//	return;
		//}

		//setLocalQA({ ...localQA, answer: response });
	}

	function onPromptSelected(prompt: string) {
		setLocalQA({ ...localQA, question: prompt });
		setSuggestedPrompts(null);
		answerTextareaRef.current?.focus();
	}

	function onAnswerSelected(answer: string) {
		setLocalQA({ ...localQA, answer });
		setSuggestedAnswers(null);
	}

	function onAISettingsClicked() {
		popupsState.addPopup(PopupStates.VqaAiSettings);
	}

	async function onSuggestCategoryClicked() {
		const response = await openAICompatRequest(
			"",
			"http://localhost:5032/v1/chat/completions",
			"add-source",
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: localQA.question,
						},
					],
				},
			],
			128,
			0.7,
			0.9,
		);

		setQACategory(response.trim());
	}

	function handleEscape(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
		if (e.key === "Escape") {
			(e.target as HTMLInputElement | HTMLTextAreaElement).blur();
		}
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Visual Q & A</h3>
				<div className="columnHeaderButtons">
					<button onClick={onAISettingsClicked} title="Open AI Settings">
						AI Settings
					</button>
					<button onClick={onCustomClicked} title="Ask the custom AI model for a suggested question">
						Custom {isCustomLoading ? <Icon icon={arrowSync24Filled} className="spinner" /> : null}
					</button>
					<button onClick={onCustom2Clicked} title="Ask the custom AI model for a suggested answer">
						CustomA {isCustom2Loading ? <Icon icon={arrowSync24Filled} className="spinner" /> : null}
					</button>
					<button onClick={onSuggestQuestionsClicked} title="Ask Gemini for a suggested question">
						Suggest Qs
					</button>
					<button onClick={onSuggestAnswersClicked} title="Ask the list of AI models to suggest an answer">
						Suggest As {isSuggestAnswersLoading ? <Icon icon={arrowSync24Filled} className="spinner" /> : null}
					</button>
					<button
						onClick={onRevertClicked}
						disabled={!isUnsaved}
						title="Revert to the server's version of the question and answer"
					>
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
			{suggestedAnswers && (
				<div className="suggested-prompts">
					<h4>Suggested Answers:</h4>
					<ul>
						{suggestedAnswers.map((answer, index) => (
							<li key={index} onClick={() => onAnswerSelected(answer)}>
								{answer}
							</li>
						))}
					</ul>
				</div>
			)}
			<div className="remainingSpace vqaEditor">
				<div className="category-input-container">
					<input
						placeholder="Enter the category"
						value={qaCategory}
						onChange={(e) => setQACategory(e.target.value)}
						type="text"
						onKeyDown={handleEscape}
						tabIndex={1}
					/>
					<button
						className="ai-suggest-button"
						title="Ask the AI for a suggested category"
						onClick={onSuggestCategoryClicked}
					>
						<Icon icon={magicwand24Filled} />
					</button>
				</div>
				<textarea
					placeholder="Enter your question"
					value={localQA.question}
					onChange={onQuestionChanged}
					onKeyDown={handleEscape}
					tabIndex={2}
				/>
				<textarea
					ref={answerTextareaRef}
					placeholder="Enter the answer"
					value={localQA.answer}
					onChange={onAnswerChanged}
					onKeyDown={handleEscape}
					tabIndex={3}
				/>
				<div className="word-count-overlay"># words: {wordCount}</div>
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
		reader.onerror = (err: ProgressEvent<FileReader>) => reject(new Error(`Failed to read image: ${err.type}`));
		reader.readAsDataURL(blob);
	});
}

async function getImageAsDataUrl(imageId: number): Promise<string> {
	const response = await authenticatedFetch(imageIdToUrl(imageId));
	if (!response.ok) {
		throw new Error(`Failed to fetch image: ${response.statusText}`);
	}

	const blob = await response.blob();

	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const dataUrl = reader.result?.toString() ?? "";
			resolve(dataUrl);
		};
		reader.onerror = (err: ProgressEvent<FileReader>) => reject(new Error(`Failed to read image: ${err.type}`));
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
		alert(`Error running Gemini: ${String(e)}`);
		return "";
	}
}

async function* doCustom(
	image_id: number,
	model: string,
	prompt: string,
	port: number = 5048,
	system_message: string = "You are a helpful image captioner.",
	temperature: number = 1.0,
): AsyncGenerator<string> {
	const client = new OpenAI({
		apiKey: "fungal",
		baseURL: `http://127.0.0.1:${port}/v1`,
		dangerouslyAllowBrowser: true,
	});

	try {
		const dataUrl = await getImageAsDataUrl(image_id);
		const stream = await client.chat.completions.create({
			model: model,
			messages: [
				{
					role: "system",
					content: system_message,
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: prompt,
						},
						{
							type: "image_url",
							image_url: {
								url: dataUrl,
							},
						},
					],
				},
			],
			stream: true,
			top_p: 0.9,
			temperature: temperature,
			max_tokens: 1024,
		});

		let response = "";

		for await (const chunk of stream) {
			const piece = chunk.choices[0]?.delta?.content || "";

			response += piece;
			yield response;
		}
	} catch (e) {
		alert(`Error running custom model: ${String(e)}`);
		yield "";
	}
}

async function multiModelSuggestions(prompt: string, imageId: number, models: MultiModel[]): Promise<string[]> {
	try {
		// Get API key
		let apiKey = localStorage.getItem("OPENROUTER_API_KEY");
		if (apiKey === null) {
			apiKey = await asyncPrompt("Enter API key");
			if (apiKey === null) {
				return [];
			}
			localStorage.setItem("OPENROUTER_API_KEY", apiKey);
		}

		// Get image
		const dataUrl = await getImageAsDataUrl(imageId);

		// Construct messages
		const messages = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: dataUrl,
					},
					{
						type: "text",
						text: prompt,
					},
				],
			},
		];

		// Get suggestions
		const suggestions = await multiModelRequest(
			apiKey,
			"https://openrouter.ai/api/v1/chat/completions",
			models,
			messages,
			1024,
		);

		return suggestions;
	} catch (e) {
		alert(`Error running multi-model suggestions: ${String(e)}`);
		return [];
	}
}

async function multiModelRequest(
	api_key: string,
	url: string,
	models: MultiModel[],
	messages: object[],
	max_tokens: number,
): Promise<string[]> {
	const responses: Promise<string | null>[] = [];

	for (const model of models) {
		let model_messages = messages.slice();
		if (model.systemMessage.trim() != "") {
			model_messages = [
				{
					role: "system",
					content: model.systemMessage.trim(),
				},
				...model_messages,
			];
		}

		responses.push(
			openAICompatRequest(api_key, url, model.model, model_messages, max_tokens)
				.then((response) => response)
				.catch((error) => {
					console.error(`Error running model ${model.model}: ${error}`);
					return null;
				}),
		);
	}

	const results = await Promise.all(responses);

	return results.filter((result) => result !== null);
}

async function openAICompatRequest(
	api_key: string,
	url: string,
	model: string,
	messages: object[],
	max_tokens: number,
	temperature?: number,
	top_p?: number,
): Promise<string> {
	const body: { model: string; messages: object[]; max_tokens: number; temperature?: number; top_p?: number } = {
		model,
		messages,
		max_tokens,
	};

	if (temperature !== undefined) {
		body["temperature"] = temperature;
	}

	if (top_p !== undefined) {
		body["top_p"] = top_p;
	}

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${api_key}`,
		},
		body: JSON.stringify(body),
	});

	interface Response {
		choices: {
			message: {
				role: string;
				content: string;
			};
		}[];
	}

	const json = (await response.json()) as Response;

	const message = json.choices[0].message.content;

	return message;
}
