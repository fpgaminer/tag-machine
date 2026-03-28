import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
	addImageAttribute,
	errorMessageState,
	imageIdToUrl,
	ImageObject,
	popupsState,
	PopupStates,
	removeImageAttribute,
} from "./state";
import SaveButton from "./SaveButton";
import { GoogleGenAI, MediaResolution, type SafetySetting, ThinkingLevel, Type } from "@google/genai";
import { authenticatedFetch } from "./api";
import { MultiModel, normalizeQuestionCustomSettings, QuestionCustomSettings } from "./VQAAIConfigPopup";
import { Icon } from "@iconify-icon/react";
import { observer } from "mobx-react";
import OpenAI from "openai";
import useLocalStorageState from "./useLocalStateStorage";
import { useCommandPaletteCommands } from "./CommandPalette";

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

interface VQATemplateSettings {
	enabled: boolean;
	template: LocalDraft | null;
}

interface SuggestedAnswer {
	model: string;
	answer: string;
}

interface CustomRequestOptions {
	baseUrl?: string;
	systemMessage?: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	presencePenalty?: number;
	topK?: number;
	extraBody?: Record<string, unknown>;
}

const EMPTY_DRAFT_SOURCE = {
	question: "",
	answer: "",
	categories: [] as string[],
};

const VQA_TEMPLATE_STORAGE_KEY = "vqa-template-settings";
const VQA_DRAFT_DEBOUNCE_MS = 300;

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
		categoriesInput: typeof source?.categoriesInput === "string" ? source.categoriesInput : categories.join(","),
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

function toLocalDraft(source: { question: string; answer: string; categories: string[] }): LocalDraft {
	return {
		question: source.question,
		answer: source.answer,
		categories: source.categories,
		categoriesInput: source.categories.join(","),
	};
}

function isDraftBlank(source: { question: string; answer: string; categories: string[] }): boolean {
	return (
		source.question.trim() === "" && source.answer.trim() === "" && normalizeCategories(source.categories).length === 0
	);
}

function getDraftStorageKey(imageId: number): string {
	return `vqa-drafts-${imageId}`;
}

function readStoredDraft(
	imageId: number,
	serverDraft: { question: string; answer: string; categories: string[] },
): LocalDraft | null {
	const storedDraft = localStorage.getItem(getDraftStorageKey(imageId));
	if (storedDraft === null) {
		return null;
	}

	try {
		return buildDraft(JSON.parse(storedDraft) as Partial<LocalDraft>, serverDraft);
	} catch (error) {
		console.error(`Error reading VQA draft for image ${imageId}:`, error);
		return null;
	}
}

function writeStoredDraft(imageId: number, draft: LocalDraft): void {
	localStorage.setItem(getDraftStorageKey(imageId), JSON.stringify(draft));
}

function normalizeTemplateSettings(source: Partial<VQATemplateSettings> | null | undefined): VQATemplateSettings {
	return {
		enabled: Boolean(source?.enabled),
		template: source?.template ? buildDraft(source.template, EMPTY_DRAFT_SOURCE) : null,
	};
}

type SuggestionMenu = "question" | "answer" | "settings" | null;

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
	const [templateSettings, setTemplateSettings] = useLocalStorageState<VQATemplateSettings>(
		VQA_TEMPLATE_STORAGE_KEY,
		{ enabled: false, template: null },
		{
			sync: true,
			deserialize: (value) => normalizeTemplateSettings(JSON.parse(value) as Partial<VQATemplateSettings>),
		},
	);
	const [draft, setDraft] = useState<LocalDraft>(() => toLocalDraft(serverDraft));
	const [shouldPersistDraft, setShouldPersistDraft] = useState(false);
	const [isTemplatePreviewActive, setIsTemplatePreviewActive] = useState(false);
	const normalizedDraftCategories = useMemo(() => normalizeCategories(draft.categories), [draft.categories]);

	const wordCount = useMemo(() => draft.answer.trim().split(/\s+/).filter(Boolean).length, [draft.answer]);

	const isUnsaved =
		draft.question !== parsedQA?.question ||
		draft.answer !== parsedQA?.answer ||
		!areCategoriesEqual(normalizedDraftCategories, imageCategories);
	const hasTemplateCategoryText = isTemplatePreviewActive && draft.categoriesInput.trim() !== "";
	const hasTemplateQuestionText = isTemplatePreviewActive && draft.question.trim() !== "";
	const hasTemplateAnswerText = isTemplatePreviewActive && draft.answer.trim() !== "";

	// ─────────────────── UI state / refs ───────────────────
	const categoryInputRef = useRef<HTMLInputElement>(null);
	const questionTextareaRef = useRef<HTMLTextAreaElement>(null);
	const questionFieldRef = useRef<HTMLDivElement>(null);
	const answerTextareaRef = useRef<HTMLTextAreaElement>(null);
	const answerFieldRef = useRef<HTMLDivElement>(null);
	const settingsMenuRef = useRef<HTMLDivElement>(null);
	const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
	const [suggestedAnswers, setSuggestedAnswers] = useState<SuggestedAnswer[] | null>(null);
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
			setShouldPersistDraft(false);
			setIsTemplatePreviewActive(false);
		} catch (err) {
			errorMessageState.setErrorMessage(`Failed to save VQA data: ${String(err)}`);
		}
	}, [imageId, draft, parsedQA, imageCategories, normalizedDraftCategories]);

	useEffect(() => {
		const storedDraft = readStoredDraft(imageId, serverDraft);

		if (storedDraft !== null) {
			setDraft(storedDraft);
			setShouldPersistDraft(true);
			setIsTemplatePreviewActive(false);
		} else if (templateSettings.enabled && templateSettings.template !== null && isDraftBlank(serverDraft)) {
			setDraft(buildDraft(templateSettings.template, serverDraft));
			setShouldPersistDraft(false);
			setIsTemplatePreviewActive(true);
		} else {
			setDraft(toLocalDraft(serverDraft));
			setShouldPersistDraft(false);
			setIsTemplatePreviewActive(false);
		}

		setSuggestedPrompts(null);
		setSuggestedAnswers(null);
		setActiveSuggestionMenu(null);
	}, [imageId]);

	useEffect(() => {
		if (!shouldPersistDraft) {
			return;
		}

		const timeout = window.setTimeout(() => {
			writeStoredDraft(imageId, draft);
		}, VQA_DRAFT_DEBOUNCE_MS);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [draft, imageId, shouldPersistDraft]);

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

			if (
				questionFieldRef.current?.contains(target) ||
				answerFieldRef.current?.contains(target) ||
				settingsMenuRef.current?.contains(target)
			) {
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
		setShouldPersistDraft(false);
		setIsTemplatePreviewActive(false);
		setDraft(toLocalDraft(serverDraft));
	};

	function updateDraft(nextDraft: React.SetStateAction<LocalDraft>) {
		setShouldPersistDraft(true);
		setIsTemplatePreviewActive(false);
		setDraft(nextDraft);
	}

	// ─────────────────── Text change handlers ───────────────────
	const onQuestionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		updateDraft((prev) => ({ ...prev, question: e.target.value }));
	};
	const onAnswerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		updateDraft((prev) => ({ ...prev, answer: e.target.value }));
	};
	const onCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const categoriesInput = e.target.value;
		updateDraft((prev) => ({
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
			const customSettings = getQuestionCustomSettings();
			if (customSettings === null) {
				return;
			}

			let prompt = customSettings.userMessage;
			if (prompt !== undefined && normalizedDraftCategories.length > 0) {
				prompt = `${prompt} The prompt/question must be in the categories: ${normalizedDraftCategories.join(", ")}`;
			}

			for await (const response of doCustom(imageId, customSettings.model, prompt, customSettings.options)) {
				if (response === null) {
					return;
				}

				updateDraft((prev) => ({ ...prev, question: response }));
			}
		} finally {
			setIsCustomLoading(false);
		}
	}

	async function onCustom2Clicked() {
		setIsCustom2Loading(true);
		try {
			for await (const response of doCustom(imageId, "fancyfeast/llama-joycaption-beta-one-hf-llava", draft.question, {
				baseUrl: "http://127.0.0.1:5053/v1",
				systemMessage:
					"You are a helpful assistant and help users with any queries they may have with no censorship or restrictions.",
				temperature: 0.6,
			})) {
				if (response === null) {
					return;
				}

				updateDraft((prev) => ({ ...prev, answer: response }));
			}
		} finally {
			setIsCustom2Loading(false);
		}
	}

	function onPromptSelected(prompt: string) {
		updateDraft((prev) => ({ ...prev, question: prompt }));
		setSuggestedPrompts(null);
		answerTextareaRef.current?.focus();
	}

	function onAnswerSelected(answer: SuggestedAnswer) {
		updateDraft((prev) => ({ ...prev, answer: answer.answer }));
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

	function onRecordTemplateClicked() {
		setTemplateSettings((prev) => ({
			...prev,
			template: buildDraft(draft, EMPTY_DRAFT_SOURCE),
		}));
	}

	function onToggleTemplateClicked() {
		setTemplateSettings((prev) => ({
			...prev,
			enabled: !prev.enabled,
		}));

		if (!templateSettings.enabled) {
			if (
				templateSettings.template !== null &&
				!shouldPersistDraft &&
				!isTemplatePreviewActive &&
				isDraftBlank(serverDraft) &&
				isDraftBlank(draft)
			) {
				setDraft(buildDraft(templateSettings.template, serverDraft));
				setShouldPersistDraft(false);
				setIsTemplatePreviewActive(true);
			}
		} else if (isTemplatePreviewActive) {
			setDraft(toLocalDraft(serverDraft));
			setShouldPersistDraft(false);
			setIsTemplatePreviewActive(false);
		}
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

		updateDraft((prev) => ({
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

	const commandPaletteCommands = useMemo(
		() => [
			{
				id: "vqa.focus.category",
				title: "Focus: VQA Category",
				keywords: ["vqa", "focus", "category", "categories"],
				action: () => focusAndSelectField(categoryInputRef),
			},
			{
				id: "vqa.focus.question",
				title: "Focus: VQA Question",
				keywords: ["vqa", "focus", "question"],
				action: () => focusAndSelectField(questionTextareaRef),
			},
			{
				id: "vqa.focus.answer",
				title: "Focus: VQA Answer",
				keywords: ["vqa", "focus", "answer"],
				action: () => focusAndSelectField(answerTextareaRef),
			},
			{
				id: "vqa.question.custom-model-suggest-question",
				title: "Question: Custom Model Suggest Question",
				keywords: ["vqa", "question", "custom", "suggest", "qs", "custom: suggest qs"],
				action: () => onCustomClicked(),
				disabled: isQuestionSuggestionLoading,
			},
			{
				id: "vqa.answer.suggest-answers",
				title: "Answer: Suggest Answers",
				keywords: ["vqa", "answer", "suggest", "as", "suggest as"],
				action: () => onSuggestAnswersClicked(),
				disabled: isAnswerSuggestionLoading,
			},
		],
		[isAnswerSuggestionLoading, isQuestionSuggestionLoading],
	);

	useCommandPaletteCommands(commandPaletteCommands);

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Visual Q & A</h3>
				<div className="columnHeaderButtons">
					<button
						onClick={onRevert}
						disabled={!isUnsaved}
						title="Revert to the server's version of the question and answer"
					>
						Revert
					</button>
					<SaveButton isUnsaved={isUnsaved} onSave={handleSave} />
					<div className="vqa-header-menu-container" ref={settingsMenuRef}>
						<button type="button" onClick={() => toggleSuggestionMenu("settings")} title="Open VQA settings">
							<Icon icon="fluent:settings-24-regular" />
						</button>
						{activeSuggestionMenu === "settings" && (
							<div className="vqa-header-menu">
								<button
									type="button"
									className="vqa-header-menu-item"
									onClick={() => {
										setActiveSuggestionMenu(null);
										onRecordTemplateClicked();
									}}
								>
									Record Template
								</button>
								<button
									type="button"
									className="vqa-header-menu-item"
									onClick={() => {
										setActiveSuggestionMenu(null);
										onToggleTemplateClicked();
									}}
								>
									{templateSettings.enabled ? "Disable Template" : "Enable Template"}
								</button>
								<button
									type="button"
									className="vqa-header-menu-item"
									onClick={() => {
										setActiveSuggestionMenu(null);
										onAISettingsClicked();
									}}
								>
									AI Settings
								</button>
							</div>
						)}
					</div>
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
				<div className="suggested-prompts suggested-answer-results">
					<div className="suggested-prompts-header">
						<h4>Suggested Answers</h4>
						<span>{suggestedAnswers.length} models</span>
					</div>
					<ul>
						{suggestedAnswers.map((answer, index) => (
							<li key={`${answer.model}-${index}`}>
								<button
									type="button"
									className="suggested-answer-card"
									onClick={() => onAnswerSelected(answer)}
									title={`Use response from ${answer.model}`}
								>
									<span className="suggested-answer-card-model">{answer.model}</span>
									<span className="suggested-answer-card-text">{answer.answer}</span>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
			<div className="remainingSpace vqaEditor">
				<div className="category-input-container">
					<input
						ref={categoryInputRef}
						className={hasTemplateCategoryText ? "vqa-template-preview" : undefined}
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
						ref={questionTextareaRef}
						className={hasTemplateQuestionText ? "vqa-template-preview" : undefined}
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
								CUSTOM: SUGGEST QS
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
						className={hasTemplateAnswerText ? "vqa-template-preview" : undefined}
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
	localStorage.removeItem(getDraftStorageKey(imageId));
}

export default observer(VQAEditor);

function focusAndSelectField(ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
	window.requestAnimationFrame(() => {
		ref.current?.focus();
		ref.current?.select();
	});
}

function blobToDataURL(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			if (typeof reader.result === "string") {
				resolve(reader.result);
			} else {
				reject(new Error("FileReader returned a non-string result"));
			}
		};

		reader.onerror = () => {
			reject(new Error("Failed to read blob as data URL"));
		};

		reader.readAsDataURL(blob);
	});
}

async function getImageAsBase64(imageId: number): Promise<{ base64: string; mimeType: string }> {
	const response = await authenticatedFetch(imageIdToUrl(imageId));
	if (!response.ok) {
		throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
	}

	const mimeType = response.headers.get("Content-Type") ?? "image/jpeg";
	const blob = await response.blob();
	const dataUrl = await blobToDataURL(blob);

	const commaIndex = dataUrl.indexOf(",");
	if (commaIndex === -1) {
		throw new Error("Invalid data URL");
	}

	return {
		base64: dataUrl.slice(commaIndex + 1),
		mimeType,
	};
}

async function getImageAsDataUrl(imageId: number): Promise<string> {
	const response = await authenticatedFetch(imageIdToUrl(imageId));
	if (!response.ok) {
		throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
	}

	const blob = await response.blob();

	return await blobToDataURL(blob);
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
				},
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
	prompt: string | undefined,
	options: CustomRequestOptions = {},
): AsyncGenerator<string> {
	const {
		baseUrl = "http://127.0.0.1:5048/v1",
		systemMessage = "You are a helpful image captioner.",
		temperature,
		maxTokens,
		topP,
		presencePenalty,
		topK,
		extraBody,
	} = options;
	const client = new OpenAI({
		apiKey: "fungal",
		baseURL: baseUrl,
		dangerouslyAllowBrowser: true,
	});

	try {
		const dataUrl = await getImageAsDataUrl(image_id);
		const messages: {
			role: "system" | "user";
			content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
		}[] = [];

		if (systemMessage !== undefined && systemMessage.trim() !== "") {
			messages.push({
				role: "system",
				content: systemMessage,
			});
		}

		const userContent: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [];
		if (prompt !== undefined && prompt.trim() !== "") {
			userContent.push({
				type: "text",
				text: prompt,
			});
		}

		userContent.push({
			type: "image_url",
			image_url: {
				url: dataUrl,
			},
		});

		messages.push({
			role: "user",
			content: userContent,
		});

		const request: Record<string, unknown> = {
			model: model,
			messages,
			stream: true,
		};

		if (extraBody !== undefined) {
			Object.assign(request, extraBody);
			request.model = model;
			request.messages = messages;
			request.stream = true;
		}

		if (temperature !== undefined) {
			request.temperature = temperature;
		}

		if (maxTokens !== undefined) {
			request.max_tokens = maxTokens;
		}

		if (topP !== undefined) {
			request.top_p = topP;
		}

		if (presencePenalty !== undefined) {
			request.presence_penalty = presencePenalty;
		}

		if (topK !== undefined) {
			request.top_k = topK;
		}

		const stream = (await client.chat.completions.create(request as never)) as unknown as AsyncIterable<{
			choices: {
				delta?: {
					content?: string;
				};
			}[];
		}>;

		let response = "";

		for await (const chunk of stream) {
			const piece = chunk.choices[0]?.delta?.content ?? "";

			response += piece;
			yield response;
		}
	} catch (e) {
		alert(`Error running custom model: ${String(e)}`);
		yield "";
	}
}

function parseOptionalNumber(value: string, fieldName: string): number | undefined {
	const trimmedValue = value.trim();
	if (trimmedValue === "") {
		return undefined;
	}

	const parsedValue = Number(trimmedValue);
	if (!Number.isFinite(parsedValue)) {
		throw new Error(`${fieldName} must be a valid number`);
	}

	return parsedValue;
}

function parseOptionalInteger(value: string, fieldName: string): number | undefined {
	const parsedValue = parseOptionalNumber(value, fieldName);
	if (parsedValue === undefined) {
		return undefined;
	}

	if (!Number.isInteger(parsedValue)) {
		throw new Error(`${fieldName} must be an integer`);
	}

	return parsedValue;
}

function parseOptionalJsonObject(value: string, fieldName: string): Record<string, unknown> | undefined {
	const trimmedValue = value.trim();
	if (trimmedValue === "") {
		return undefined;
	}

	const parsedValue = JSON.parse(trimmedValue) as unknown;
	if (parsedValue === null || Array.isArray(parsedValue) || typeof parsedValue !== "object") {
		throw new Error(`${fieldName} must be a JSON object`);
	}

	return parsedValue as Record<string, unknown>;
}

function readQuestionCustomSettings(): QuestionCustomSettings {
	const storedValue = localStorage.getItem("VQA_QUESTION_CUSTOM_SETTINGS");
	if (storedValue === null) {
		return normalizeQuestionCustomSettings(null);
	}

	try {
		return normalizeQuestionCustomSettings(
			JSON.parse(storedValue) as Partial<QuestionCustomSettings> | null | undefined,
		);
	} catch (error) {
		console.error("Error reading VQA question custom settings:", error);
		return normalizeQuestionCustomSettings(null);
	}
}

function getQuestionCustomSettings(): {
	model: string;
	userMessage?: string;
	options: CustomRequestOptions;
} | null {
	try {
		const settings = readQuestionCustomSettings();
		const model = settings.model.trim();
		if (model === "") {
			throw new Error("Question custom model name cannot be blank");
		}

		const url = settings.url.trim();
		if (url === "") {
			throw new Error("Question custom URL cannot be blank");
		}

		return {
			model,
			userMessage: settings.userMessage.trim() === "" ? undefined : settings.userMessage,
			options: {
				baseUrl: url,
				systemMessage: settings.systemMessage.trim() === "" ? undefined : settings.systemMessage,
				temperature: parseOptionalNumber(settings.temperature, "Question custom temperature"),
				maxTokens: parseOptionalInteger(settings.maxTokens, "Question custom max tokens"),
				topP: parseOptionalNumber(settings.topP, "Question custom top_p"),
				presencePenalty: parseOptionalNumber(settings.presencePenalty, "Question custom presence_penalty"),
				topK: parseOptionalInteger(settings.topK, "Question custom top_k"),
				extraBody: parseOptionalJsonObject(settings.extraBodyJson, "Question custom extra_body"),
			},
		};
	} catch (error) {
		errorMessageState.setErrorMessage(`Invalid VQA question custom settings: ${String(error)}`);
		return null;
	}
}

function extractInlineSystemMessage(prompt: string): { prompt: string; systemMessage?: string } {
	const matches = Array.from(prompt.matchAll(/<system>([\s\S]*?)<\/system>/gi));
	if (matches.length === 0) {
		return { prompt };
	}

	const systemMessage = matches
		.map((match) => match[1]?.trim() ?? "")
		.filter(Boolean)
		.join("\n\n");
	const promptWithoutSystem = prompt.replace(/<system>[\s\S]*?<\/system>/gi, "").trim();

	return {
		prompt: promptWithoutSystem,
		systemMessage: systemMessage === "" ? undefined : systemMessage,
	};
}

async function multiModelSuggestions(
	prompt: string,
	imageId: number,
	models: MultiModel[],
): Promise<SuggestedAnswer[]> {
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
		const parsedPrompt = extractInlineSystemMessage(prompt);

		// Construct messages
		const messages = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: dataUrl,
					},
					...(parsedPrompt.prompt === ""
						? []
						: [
								{
									type: "text",
									text: parsedPrompt.prompt,
								},
							]),
				],
			},
		];

		// Get suggestions
		const suggestions = await multiModelRequest(
			apiKey,
			"https://openrouter.ai/api/v1/chat/completions",
			models,
			messages,
			16384,
			parsedPrompt.systemMessage,
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
	systemMessageOverride?: string,
): Promise<SuggestedAnswer[]> {
	const responses: Promise<SuggestedAnswer | null>[] = [];

	for (const model of models) {
		let model_messages = messages.slice();
		const effectiveSystemMessage = systemMessageOverride ?? model.systemMessage.trim();
		if (effectiveSystemMessage !== "") {
			model_messages = [
				{
					role: "system",
					content: effectiveSystemMessage,
				},
				...model_messages,
			];
		}

		responses.push(
			Promise.resolve()
				.then(() => parseModelExtraOptions(model))
				.then((extraOptions) =>
					openAICompatRequest(
						api_key,
						url,
						model.model,
						model_messages,
						max_tokens,
						undefined,
						undefined,
						extraOptions,
					),
				)
				.then((response) => ({
					model: model.model,
					answer: response,
				}))
				.catch((error) => {
					console.error(`Error running model ${model.model}: ${error}`);
					return null;
				}),
		);
	}

	const results = await Promise.all(responses);

	return results.filter((result) => result !== null);
}

function parseModelExtraOptions(model: MultiModel): Record<string, unknown> | undefined {
	const rawValue = model.extraOptionsJson?.trim();
	if (!rawValue) {
		return undefined;
	}

	const parsed = JSON.parse(rawValue) as unknown;
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new Error(`Extra options for model "${model.model}" must be a JSON object`);
	}

	return parsed as Record<string, unknown>;
}

async function openAICompatRequest(
	api_key: string,
	url: string,
	model: string,
	messages: object[],
	max_tokens: number,
	temperature?: number,
	top_p?: number,
	extraOptions?: Record<string, unknown>,
): Promise<string> {
	const body: { model: string; messages: object[]; max_tokens: number; temperature?: number; top_p?: number } = {
		model,
		messages,
		max_tokens,
		...extraOptions,
	};

	if (temperature !== undefined) {
		body.temperature = temperature;
	}

	if (top_p !== undefined) {
		body.top_p = top_p;
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
