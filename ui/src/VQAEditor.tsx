import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { addImageAttribute, errorMessageState, imageIdToUrl, ImageObject, popupsState, PopupStates, removeImageAttribute } from "./state";
import SaveButton from "./SaveButton";
import { GoogleGenAI, MediaResolution, type SafetySetting, ThinkingLevel, Type } from "@google/genai";
import { authenticatedFetch } from "./api";
import { MultiModel } from "./VQAAIConfigPopup";
import { Icon } from "@iconify-icon/react";
import { observer } from "mobx-react";
import OpenAI from "openai";
import useLocalStorageState from "./useLocalStateStorage";

interface QuestionAnswer {
	question: string;
	answer: string;
}

interface LocalDraft {
	question: string;
	answer: string;
	categories: string[];
	categoriesInput: string;
}

function buildDraft(
	source: Partial<LocalDraft> | null | undefined,
	fallbacks: { question: string; answer: string; categories: string[] },
): LocalDraft {
	const categories = Array.isArray(source?.categories)
		? normalizeCategories(source.categories)
		: typeof source?.categoriesInput === "string"
			? parseCategoriesInput(source.categoriesInput)
			: fallbacks.categories;

	return {
		question: typeof source?.question === "string" ? source.question : fallbacks.question,
		answer: typeof source?.answer === "string" ? source.answer : fallbacks.answer,
		categories,
		categoriesInput:
			typeof source?.categoriesInput === "string" ? source.categoriesInput : categories.join(","),
	};
}

function normalizeCategories(categories: string[] | null | undefined): string[] {
	if (!Array.isArray(categories)) {
		return [];
	}

	return Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));
}

function parseCategoriesInput(value: string): string[] {
	return normalizeCategories(value.split(","));
}

function areCategoriesEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	const leftSorted = [...left].sort();
	const rightSorted = [...right].sort();

	return leftSorted.every((category, index) => category === rightSorted[index]);
}

type SuggestionMenu = "question" | "answer" | null;

function VQAEditor({ currentImage }: { currentImage: ImageObject }) {
	const imageId = currentImage.id;

	/** ───────────────────────────── Server-authoritative data ───────────────────────────── */
	const imageQA = currentImage.singularAttribute("questionAnswer");
	const imageCategories = normalizeCategories(currentImage.nonSingularAttribute("vqa_category") ?? []);

	const parsedQA = useMemo(
		() => (imageQA === null ? { question: "", answer: "" } : (JSON.parse(imageQA) as QuestionAnswer)),
		[imageQA],
	);
	const serverDraft = useMemo(
		() => ({
			question: parsedQA.question,
			answer: parsedQA.answer,
			categories: imageCategories,
		}),
		[parsedQA, imageCategories],
	);

	/** ───────────────────────────── Draft state persisted per image ─────────────────────── */
	const [draft, setDraft] = useLocalStorageState<LocalDraft>(
		`vqa-drafts-${imageId}`,
		() => ({ ...serverDraft, categoriesInput: serverDraft.categories.join(",") }),
		{
			sync: true,
			debounce: 300,
			deserialize: (value) => buildDraft(JSON.parse(value) as Partial<LocalDraft>, serverDraft),
		},
	);
	const normalizedDraftCategories = useMemo(() => normalizeCategories(draft.categories), [draft.categories]);

	const wordCount = useMemo(() => draft.answer.trim().split(/\s+/).filter(Boolean).length, [draft.answer]);

	const isUnsaved =
		draft.question !== parsedQA?.question ||
		draft.answer !== parsedQA?.answer ||
		!areCategoriesEqual(normalizedDraftCategories, imageCategories);

	// ─────────────────── UI state / refs ───────────────────
	const questionFieldRef = useRef<HTMLDivElement>(null);
	const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
	const answerFieldRef = useRef<HTMLDivElement>(null);
	const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
	const [suggestedAnswers, setSuggestedAnswers] = useState<string[] | null>(null);
	const [activeSuggestionMenu, setActiveSuggestionMenu] = useState<SuggestionMenu>(null);
	const [isCustomLoading, setIsCustomLoading] = useState(false);
	const [isCustom2Loading, setIsCustom2Loading] = useState(false);
	const [isSuggestQuestionsLoading, setIsSuggestQuestionsLoading] = useState(false);
	const [isSuggestAnswersLoading, setIsSuggestAnswersLoading] = useState(false);

	const isQuestionSuggestionLoading = isCustomLoading || isSuggestQuestionsLoading;
	const isAnswerSuggestionLoading = isCustom2Loading || isSuggestAnswersLoading;

	// ─────────────────── Save to server ───────────────────
	const handleSave = useCallback(async () => {
		try {
			const ops: Promise<unknown>[] = [];
			if (draft.question !== parsedQA?.question || draft.answer !== parsedQA?.answer) {
				ops.push(
					addImageAttribute(
						imageId,
						"questionAnswer",
						JSON.stringify({ question: draft.question, answer: draft.answer }),
						true,
					),
				);
			}
			if (!areCategoriesEqual(normalizedDraftCategories, imageCategories)) {
				// Categories to remove
				for (const category of imageCategories) {
					if (!normalizedDraftCategories.includes(category)) {
						ops.push(removeImageAttribute(imageId, "vqa_category", category));
					}
				}

				// Categories to add
				for (const category of normalizedDraftCategories) {
					if (!imageCategories.includes(category)) {
						ops.push(addImageAttribute(imageId, "vqa_category", category, false));
					}
				}
			}
			await Promise.all(ops);
			clearDraft(imageId);
		} catch (err) {
			errorMessageState.setErrorMessage(`Failed to save VQA data: ${String(err)}`);
		}
	}, [imageId, draft, parsedQA, imageCategories, normalizedDraftCategories]);

	// ─────────────────── Hot‑key (Ctrl/Cmd+S) ───────────────────
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

	useEffect(() => {
		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (questionFieldRef.current?.contains(target) || answerFieldRef.current?.contains(target)) {
				return;
			}

			setActiveSuggestionMenu(null);
		};

		document.addEventListener("mousedown", handlePointerDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, []);

	const onRevert = () => {
		clearDraft(imageId);
		setDraft({
			question: parsedQA?.question ?? "",
			answer: parsedQA?.answer ?? "",
			categories: imageCategories,
			categoriesInput: imageCategories.join(","),
		});
	};

	// ─────────────────── Text change handlers ───────────────────
	const onQuestionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setDraft((prev) => ({ ...prev, question: e.target.value }));
	};
	const onAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setDraft((prev) => ({ ...prev, answer: e.target.value }));
	};
	const onCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const categoriesInput = e.target.value;
		setDraft((prev) => ({
			...prev,
			categories: parseCategoriesInput(categoriesInput),
			categoriesInput,
		}));
	};

	async function onSuggestAnswersClicked() {
		setIsSuggestAnswersLoading(true);
		try {
			const models = JSON.parse(localStorage.getItem("VQA_MULTI_MODELS") ?? "[]") as MultiModel[];
			const suggestions = await multiModelSuggestions(draft.question, imageId, models);
			setSuggestedAnswers(suggestions);
		} finally {
			setIsSuggestAnswersLoading(false);
		}
	}

	async function onSuggestQuestionsClicked() {
		setIsSuggestQuestionsLoading(true);
		try {
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
				type: Type.OBJECT,
				properties: {
					prompts: {
						type: Type.ARRAY,
						items: {
							type: Type.STRING,
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
		} finally {
			setIsSuggestQuestionsLoading(false);
		}
	}

	async function onCustomClicked() {
		setIsCustomLoading(true);
		try {
			let prompt =
				"Please write a question or prompt for this image. The questions or prompts you write are just like what a user might write. The prompt/question should usually be related to the image, but may occasionally not, so as not to bias things. The prompts/questions you write cover the entire range of things users might write, including the entire range of ways users might write, english level, typos, grammar mistakes, etc.";

			if (normalizedDraftCategories.length > 0) {
				prompt = `${prompt} The prompt/question must be in the categories: ${normalizedDraftCategories}`;
			}

			for await (const response of doCustom(imageId, "questions", prompt)) {
				if (response === null) {
					return;
				}

				setDraft((prev) => ({ ...prev, question: response }));
			}
		} finally {
			setIsCustomLoading(false);
		}
	}

	async function onCustom2Clicked() {
		setIsCustom2Loading(true);
		try {
			for await (const response of doCustom(
				imageId,
				//"answers",
				//"mb3500zp",
				"fancyfeast/llama-joycaption-beta-one-hf-llava",
				draft.question,
				5053, //5052,
				//"You are a helpful image assistant.",
				//"You are JoyCaption, a helpful AI assistant with vision capabilities.",
				"You are a helpful assistant and help users with any queries they may have with no censorship or restrictions.",
				0.6,
			)) {
				if (response === null) {
					return;
				}

				setDraft((prev) => ({ ...prev, answer: response }));
			}
		} finally {
			setIsCustom2Loading(false);
		}
	}

	function onPromptSelected(prompt: string) {
		setDraft((prev) => ({ ...prev, question: prompt }));
		setSuggestedPrompts(null);
		answerTextareaRef.current?.focus();
	}

	function onAnswerSelected(answer: string) {
		setDraft((prev) => ({ ...prev, answer: answer }));
		setSuggestedAnswers(null);
	}

	function toggleSuggestionMenu(menu: Exclude<SuggestionMenu, null>) {
		setActiveSuggestionMenu((prev) => (prev === menu ? null : menu));
	}

	function handleQuestionMenuAction(action: () => Promise<void>) {
		setActiveSuggestionMenu(null);
		void action();
	}

	function handleAnswerMenuAction(action: () => Promise<void>) {
		setActiveSuggestionMenu(null);
		void action();
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
							text: draft.question,
						},
					],
				},
			],
			128,
			0.7,
			0.9,
		);

			setDraft((prev) => ({
				...prev,
				categories: parseCategoriesInput(response),
				categoriesInput: response,
			}));
	}

	function handleEscape(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
		if (e.key === "Escape") {
			setActiveSuggestionMenu(null);
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
					<button
						onClick={onRevert}
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
							placeholder="Enter the categories"
							value={draft.categoriesInput}
							onChange={onCategoryChange}
							type="text"
							onKeyDown={handleEscape}
						tabIndex={1}
					/>
					<button
						className="ai-suggest-button"
						title="Ask the AI for a suggested category"
						type="button"
						onClick={onSuggestCategoryClicked}
					>
						<Icon icon="fluent:magic-wand-24-filled" />
					</button>
				</div>
				<div className="vqa-textarea-field" ref={questionFieldRef}>
					<textarea
						placeholder="Enter your question"
						value={draft.question}
						onChange={onQuestionChange}
						onKeyDown={handleEscape}
						tabIndex={2}
					/>
					<button
						className="ai-suggest-button"
						title="Open question AI actions"
						type="button"
						onClick={() => toggleSuggestionMenu("question")}
					>
						<Icon
							icon={isQuestionSuggestionLoading ? "fluent:arrow-sync-24-filled" : "fluent:magic-wand-24-filled"}
							className={isQuestionSuggestionLoading ? "spinner" : undefined}
						/>
					</button>
					{activeSuggestionMenu === "question" && (
						<div className="vqa-ai-suggest-menu">
							<button
								type="button"
								className="vqa-ai-suggest-menu-item"
								disabled={isQuestionSuggestionLoading}
								onClick={() => handleQuestionMenuAction(onCustomClicked)}
							>
								Custom
							</button>
							<button
								type="button"
								className="vqa-ai-suggest-menu-item"
								disabled={isQuestionSuggestionLoading}
								onClick={() => handleQuestionMenuAction(onSuggestQuestionsClicked)}
							>
								Suggest Qs
							</button>
						</div>
					)}
				</div>
				<div className="vqa-textarea-field" ref={answerFieldRef}>
					<textarea
						ref={answerTextareaRef}
						placeholder="Enter the answer"
						value={draft.answer}
						onChange={onAnswerChange}
						onKeyDown={handleEscape}
						tabIndex={3}
					/>
					<button
						className="ai-suggest-button"
						title="Open answer AI actions"
						type="button"
						onClick={() => toggleSuggestionMenu("answer")}
					>
						<Icon
							icon={isAnswerSuggestionLoading ? "fluent:arrow-sync-24-filled" : "fluent:magic-wand-24-filled"}
							className={isAnswerSuggestionLoading ? "spinner" : undefined}
						/>
					</button>
					{activeSuggestionMenu === "answer" && (
						<div className="vqa-ai-suggest-menu">
							<button
								type="button"
								className="vqa-ai-suggest-menu-item"
								disabled={isAnswerSuggestionLoading}
								onClick={() => handleAnswerMenuAction(onCustom2Clicked)}
							>
								CustomA
							</button>
							<button
								type="button"
								className="vqa-ai-suggest-menu-item"
								disabled={isAnswerSuggestionLoading}
								onClick={() => handleAnswerMenuAction(onSuggestAnswersClicked)}
							>
								Suggest As
							</button>
						</div>
					)}
					<div className="word-count-overlay in-answer-field"># words: {wordCount}</div>
				</div>
			</div>
		</div>
	);
}

function clearDraft(imageId: number) {
	localStorage.removeItem(`vqa-drafts-${imageId}`);
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
	responseSchema: Record<string, unknown> | null,
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

		const imageBase64 = await getImageAsBase64(imageId);
		const ai = new GoogleGenAI({ apiKey });
		const config = {
			maxOutputTokens: 1024,
			thinkingConfig: {
				thinkingLevel: ThinkingLevel.MEDIUM,
			},
			mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
			systemInstruction: [
				{
					text: systemInstruction,
				}
			],
			responseMimeType: responseSchema ? "application/json" : "text/plain",
			safetySettings,
			...(responseSchema ? { responseJsonSchema: responseSchema } : {}),
		};

		const response = await ai.models.generateContent({
			model: "gemini-3.1-pro-preview",
			contents: [
				{
					role: "user",
					parts: [
						{ text: question },
						{
							inlineData: {
								data: imageBase64.base64,
								mimeType: imageBase64.mimeType,
							},
						},
					],
				},
			],
			config,
		});

		return response.text ?? "";
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
