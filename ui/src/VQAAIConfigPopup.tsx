import useLocalStorageState from "./useLocalStateStorage";
import Popup from "./Popup";
import { popupsState, PopupStates } from "./state";

export interface MultiModel {
	model: string;
	systemMessage: string;
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
	const [multiModels, setMultiModels] = useLocalStorageState<MultiModel[]>("VQA_MULTI_MODELS", [], { sync: true });
	const [geminiSafetySettings, setGeminiSafetySettings] = useLocalStorageState<string>("GEMINI_SAFETY_SETTINGS", "", {
		sync: true,
	});

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
	}

	function onMultiModelsSystemMessageChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
		const newModels = multiModels.slice();
		newModels[index].systemMessage = e.target.value;
		setMultiModels(newModels);
	}

	function onAddMultiModel() {
		const newModels = [...multiModels, { model: "", systemMessage: "" }];
		setMultiModels(newModels);
	}

	function onRemoveMultiModel(index: number) {
		const newModels = multiModels.slice();
		newModels.splice(index, 1);
		setMultiModels(newModels);
	}

	function onGeminiSafetySettingsChange(e: React.ChangeEvent<HTMLInputElement>) {
		setGeminiSafetySettings(e.target.value);
	}

	return (
		<Popup
			onClose={() => popupsState.removePopup(PopupStates.VqaAiSettings)}
			title="VQA AI Settings"
			className="user-popup-window"
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
