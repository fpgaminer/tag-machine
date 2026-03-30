import useLocalStorageState from "./useLocalStateStorage";
import Popup from "./Popup";
import { popupsState, PopupStates } from "./state";

export const VQA_MULTI_MODELS_STORAGE_KEY = "VQA_MULTI_MODELS";
export const VQA_MULTI_MODELS_UPDATED_EVENT = "vqa-multi-models-updated";

export interface MultiModel {
	model: string;
	systemMessage: string;
	extraOptionsJson: string;
}

export interface QuestionCustomSettings {
	url: string;
	model: string;
	systemMessage: string;
	userMessage: string;
	temperature: string;
	maxTokens: string;
	topP: string;
	presencePenalty: string;
	topK: string;
	extraBodyJson: string;
}

export function normalizeMultiModel(model: Partial<MultiModel> | null | undefined): MultiModel {
	return {
		model: typeof model?.model === "string" ? model.model : "",
		systemMessage: typeof model?.systemMessage === "string" ? model.systemMessage : "",
		extraOptionsJson: typeof model?.extraOptionsJson === "string" ? model.extraOptionsJson : "",
	};
}

export function readMultiModelsFromStorage(): MultiModel[] {
	const storedValue = localStorage.getItem(VQA_MULTI_MODELS_STORAGE_KEY);
	if (storedValue === null) {
		return [];
	}

	try {
		const parsed = JSON.parse(storedValue) as unknown;
		return (Array.isArray(parsed) ? parsed : []).map((model) => normalizeMultiModel(model as Partial<MultiModel>));
	} catch (error) {
		console.error("Error reading VQA multi models:", error);
		return [];
	}
}

function notifyMultiModelsUpdated(models: MultiModel[]) {
	window.dispatchEvent(new CustomEvent<MultiModel[]>(VQA_MULTI_MODELS_UPDATED_EVENT, { detail: models }));
}

export function normalizeQuestionCustomSettings(
	settings: Partial<QuestionCustomSettings> | null | undefined,
): QuestionCustomSettings {
	return {
		url: typeof settings?.url === "string" ? settings.url : "http://127.0.0.1:5048/v1",
		model: typeof settings?.model === "string" ? settings.model : "questions",
		systemMessage:
			typeof settings?.systemMessage === "string" ? settings.systemMessage : "You are a helpful image captioner.",
		userMessage:
			typeof settings?.userMessage === "string"
				? settings.userMessage
				: "Please write a question or prompt for this image. The questions or prompts you write are just like what a user might write. The prompt/question should usually be related to the image, but may occasionally not, so as not to bias things. The prompts/questions you write cover the entire range of things users might write, including the entire range of ways users might write, english level, typos, grammar mistakes, etc.",
		temperature: typeof settings?.temperature === "string" ? settings.temperature : "1",
		maxTokens: typeof settings?.maxTokens === "string" ? settings.maxTokens : "1024",
		topP: typeof settings?.topP === "string" ? settings.topP : "0.9",
		presencePenalty: typeof settings?.presencePenalty === "string" ? settings.presencePenalty : "",
		topK: typeof settings?.topK === "string" ? settings.topK : "",
		extraBodyJson: typeof settings?.extraBodyJson === "string" ? settings.extraBodyJson : "",
	};
}

function VQAAIConfigPopup() {
	// TODO: Encrypt API keys using the a key derived from the user's current token.
	// This will result in the API keys being lost when the user logs out, but ensures that the API keys are not stored in plaintext in the local storage.
	const openrouter_api_key_is_set = localStorage.getItem("OPENROUTER_API_KEY") !== null;
	const gemini_api_key_is_set = localStorage.getItem("GEMINI_API_KEY") !== null;
	const [suggestQuestionsPrompt, setSuggestQuestionsPrompt] = useLocalStorageState<string>(
		"GEMINI_GEN_VQA_QUESTIONS_PROMPT",
		"",
		{ sync: true },
	);
	const [geminiSystemMessage, setGeminiSystemMessage] = useLocalStorageState<string>("GEMINI_SYSTEM_INSTRUCTION", "", {
		sync: true,
	});
	const [multiModels, setMultiModels] = useLocalStorageState<MultiModel[]>(VQA_MULTI_MODELS_STORAGE_KEY, [], {
		sync: true,
		deserialize: (value) => {
			const parsed = JSON.parse(value) as unknown;
			return (Array.isArray(parsed) ? parsed : []).map((model) => normalizeMultiModel(model as Partial<MultiModel>));
		},
	});
	const [geminiSafetySettings, setGeminiSafetySettings] = useLocalStorageState<string>("GEMINI_SAFETY_SETTINGS", "", {
		sync: true,
	});
	const [questionCustomSettings, setQuestionCustomSettings] = useLocalStorageState<QuestionCustomSettings>(
		"VQA_QUESTION_CUSTOM_SETTINGS",
		normalizeQuestionCustomSettings(null),
		{
			sync: true,
			deserialize: (value) =>
				normalizeQuestionCustomSettings(JSON.parse(value) as Partial<QuestionCustomSettings> | null | undefined),
		},
	);

	function setOpenRouterAPIKey() {
		const key = prompt("Enter OpenRouter API Key");

		if (key === null) {
			return;
		}

		localStorage.setItem("OPENROUTER_API_KEY", key);
	}

	function setGeminiAPIKey() {
		const key = prompt("Enter Gemini API Key");

		if (key === null) {
			return;
		}

		localStorage.setItem("GEMINI_API_KEY", key);
	}

	function onSuggestQuestionsPromptChange(e: React.ChangeEvent<HTMLInputElement>) {
		setSuggestQuestionsPrompt(e.target.value);
	}

	function onGeminiSystemMessageChange(e: React.ChangeEvent<HTMLInputElement>) {
		setGeminiSystemMessage(e.target.value);
	}

	function onMultiModelsChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
		const newModels = multiModels.slice();
		newModels[index].model = e.target.value;
		setMultiModels(newModels);
		notifyMultiModelsUpdated(newModels);
	}

	function onMultiModelsSystemMessageChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
		const newModels = multiModels.slice();
		newModels[index].systemMessage = e.target.value;
		setMultiModels(newModels);
		notifyMultiModelsUpdated(newModels);
	}

	function onMultiModelsExtraOptionsChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
		const newModels = multiModels.slice();
		newModels[index].extraOptionsJson = e.target.value;
		setMultiModels(newModels);
		notifyMultiModelsUpdated(newModels);
	}

	function onAddMultiModel() {
		const newModels = [...multiModels, { model: "", systemMessage: "", extraOptionsJson: "" }];
		setMultiModels(newModels);
		notifyMultiModelsUpdated(newModels);
	}

	function onRemoveMultiModel(index: number) {
		const newModels = multiModels.slice();
		newModels.splice(index, 1);
		setMultiModels(newModels);
		notifyMultiModelsUpdated(newModels);
	}

	function onGeminiSafetySettingsChange(e: React.ChangeEvent<HTMLInputElement>) {
		setGeminiSafetySettings(e.target.value);
	}

	function onQuestionCustomSettingsChange(
		e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		key: keyof QuestionCustomSettings,
	) {
		setQuestionCustomSettings((prev) => ({
			...prev,
			[key]: e.target.value,
		}));
	}

	return (
		<Popup
			onClose={() => popupsState.removePopup(PopupStates.VqaAiSettings)}
			title="VQA AI Settings"
			className="vqa-ai-config-popup"
		>
			<div className="popup-window-body-content">
				OpenRouter API Key: {openrouter_api_key_is_set ? "Set" : "Not Set"}
				<button onClick={setOpenRouterAPIKey}>Set OpenRouter API Key</button>
				<br />
				Gemini API Key: {gemini_api_key_is_set ? "Set" : "Not Set"}
				<button onClick={setGeminiAPIKey}>Set Gemini API Key</button>
				<br />
				<div className="input-group">
					<label htmlFor="suggest-questions-prompt">Suggest Questions Prompt</label>
					<input type="text" placeholder=" " value={suggestQuestionsPrompt} onChange={onSuggestQuestionsPromptChange} />
				</div>
				<div className="input-group">
					<label htmlFor="gemini-system-message">Gemini System Message</label>
					<input type="text" placeholder=" " value={geminiSystemMessage} onChange={onGeminiSystemMessageChange} />
				</div>
				<div className="input-group">
					<label htmlFor="gemini-safety-settings">Gemini Safety Settings</label>
					<input type="text" placeholder=" " value={geminiSafetySettings} onChange={onGeminiSafetySettingsChange} />
				</div>
				<div>Question Custom Model</div>
				<div className="input-group">
					<label htmlFor="question-custom-url">URL</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.url}
						onChange={(e) => onQuestionCustomSettingsChange(e, "url")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-model">Model</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.model}
						onChange={(e) => onQuestionCustomSettingsChange(e, "model")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-system-message">System Message</label>
					<textarea
						placeholder=" "
						value={questionCustomSettings.systemMessage}
						onChange={(e) => onQuestionCustomSettingsChange(e, "systemMessage")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-user-message">User Message</label>
					<textarea
						placeholder=" "
						value={questionCustomSettings.userMessage}
						onChange={(e) => onQuestionCustomSettingsChange(e, "userMessage")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-temperature">Temperature</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.temperature}
						onChange={(e) => onQuestionCustomSettingsChange(e, "temperature")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-max-tokens">Max Tokens</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.maxTokens}
						onChange={(e) => onQuestionCustomSettingsChange(e, "maxTokens")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-top-p">Top P</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.topP}
						onChange={(e) => onQuestionCustomSettingsChange(e, "topP")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-presence-penalty">Presence Penalty</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.presencePenalty}
						onChange={(e) => onQuestionCustomSettingsChange(e, "presencePenalty")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-top-k">Top K</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.topK}
						onChange={(e) => onQuestionCustomSettingsChange(e, "topK")}
					/>
				</div>
				<div className="input-group">
					<label htmlFor="question-custom-extra-body-json">Extra Body JSON</label>
					<input
						type="text"
						placeholder=" "
						value={questionCustomSettings.extraBodyJson}
						onChange={(e) => onQuestionCustomSettingsChange(e, "extraBodyJson")}
					/>
				</div>
				<div>Multi Models</div>
				<div className="multi-models-settings">
					{multiModels.map((model, index) => (
						<div key={index}>
							<div className="input-group">
								<label htmlFor="model">Model</label>
								<input
									type="text"
									placeholder=" "
									value={model.model}
									onChange={(e) => onMultiModelsChange(e, index)}
								/>
							</div>
							<div className="input-group">
								<label htmlFor="system-message">System Message</label>
								<input
									type="text"
									placeholder=" "
									value={model.systemMessage}
									onChange={(e) => onMultiModelsSystemMessageChange(e, index)}
								/>
							</div>
							<div className="input-group">
								<label htmlFor="extra-options-json">Extra Options JSON</label>
								<input
									type="text"
									placeholder=" "
									value={model.extraOptionsJson}
									onChange={(e) => onMultiModelsExtraOptionsChange(e, index)}
								/>
							</div>
							<button onClick={() => onRemoveMultiModel(index)}>Remove</button>
						</div>
					))}
					<button onClick={onAddMultiModel}>Add</button>
				</div>
			</div>
		</Popup>
	);
}

export default VQAAIConfigPopup;
