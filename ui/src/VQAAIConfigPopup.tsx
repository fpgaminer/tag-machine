import { observer } from "mobx-react";
import { useState, useEffect } from "react";
import { makeAutoObservable } from "mobx";

export interface MultiModel {
	model: string;
	systemMessage: string;
}

function VQAAIConfigPopup() {
	const openrouter_api_key_is_set = localStorage.getItem("OPENROUTER_API_KEY") !== null;
	const gemini_api_key_is_set = localStorage.getItem("GEMINI_API_KEY") !== null;
	const [suggestQuestionsPrompt, setSuggestQuestionsPrompt] = useState<string>("");
	const [geminiSystemMessage, setGeminiSystemMessage] = useState<string>("");
	const [multiModels, setMultiModels] = useState<MultiModel[]>([]);
	const [geminiSafetySettings, setGeminiSafetySettings] = useState<string>("");

	useEffect(() => {
		// Get saved settings
		const multi_models = JSON.parse(localStorage.getItem("VQA_MULTI_MODELS") ?? "[]") as MultiModel[];
		const suggest_questions_prompt = localStorage.getItem("GEMINI_GEN_VQA_QUESTIONS_PROMPT") ?? "";
		const gemini_system_message = localStorage.getItem("GEMINI_SYSTEM_INSTRUCTION") ?? "";
		const gemini_safety_settings = localStorage.getItem("GEMINI_SAFETY_SETTINGS") ?? "";

		setMultiModels(multi_models);
		setSuggestQuestionsPrompt(suggest_questions_prompt);
		setGeminiSystemMessage(gemini_system_message);
		setGeminiSafetySettings(gemini_safety_settings);
	}, []);

	function onBackgroundClicked(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		if (e.target === e.currentTarget) {
			vqaAIConfigPopupState.setVisible(false);
		}
	}

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
		localStorage.setItem("GEMINI_GEN_VQA_QUESTIONS_PROMPT", e.target.value);
	}

	function onGeminiSystemMessageChange(e: React.ChangeEvent<HTMLInputElement>) {
		setGeminiSystemMessage(e.target.value);
		localStorage.setItem("GEMINI_SYSTEM_INSTRUCTION", e.target.value);
	}

	function onMultiModelsChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
		const newModels = multiModels.slice();
		newModels[index].model = e.target.value;
		setMultiModels(newModels);
		localStorage.setItem("VQA_MULTI_MODELS", JSON.stringify(newModels));
	}

	function onMultiModelsSystemMessageChange(e: React.ChangeEvent<HTMLInputElement>, index: number) {
		const newModels = multiModels.slice();
		newModels[index].systemMessage = e.target.value;
		setMultiModels(newModels);
		localStorage.setItem("VQA_MULTI_MODELS", JSON.stringify(newModels));
	}

	function onAddMultiModel() {
		const newModels = [...multiModels, { model: "", systemMessage: "" }];
		setMultiModels(newModels);
		localStorage.setItem("VQA_MULTI_MODELS", JSON.stringify(newModels));
	}

	function onRemoveMultiModel(index: number) {
		const newModels = multiModels.slice();
		newModels.splice(index, 1);
		setMultiModels(newModels);
		localStorage.setItem("VQA_MULTI_MODELS", JSON.stringify(newModels));
	}

	function onGeminiSafetySettingsChange(e: React.ChangeEvent<HTMLInputElement>) {
		setGeminiSafetySettings(e.target.value);
		localStorage.setItem("GEMINI_SAFETY_SETTINGS", e.target.value);
	}

	return (
		<div className="popup-background" onClick={onBackgroundClicked}>
			<div className="popup-window user-popup-window">
				<div className="popup-window-content">
					<div className="popup-window-header">
						<div className="popup-window-title">VQA AI Settings</div>
						<div className="popup-window-close" onClick={() => vqaAIConfigPopupState.setVisible(false)}>
							&times;
						</div>
					</div>
					<div className="popup-window-body">
						<div className="popup-window-body-content">
							OpenRouter API Key: {openrouter_api_key_is_set ? "Set" : "Not Set"}
							<button onClick={setOpenRouterAPIKey}>Set OpenRouter API Key</button>
							<br />
							Gemini API Key: {gemini_api_key_is_set ? "Set" : "Not Set"}
							<button onClick={setGeminiAPIKey}>Set Gemini API Key</button>
							<br />
							<div className="input-group">
								<label htmlFor="suggest-questions-prompt">Suggest Questions Prompt</label>
								<input
									type="text"
									placeholder=" "
									value={suggestQuestionsPrompt}
									onChange={onSuggestQuestionsPromptChange}
								/>
							</div>
							<div className="input-group">
								<label htmlFor="gemini-system-message">Gemini System Message</label>
								<input type="text" placeholder=" " value={geminiSystemMessage} onChange={onGeminiSystemMessageChange} />
							</div>
							<div className="input-group">
								<label htmlFor="gemini-safety-settings">Gemini Safety Settings</label>
								<input
									type="text"
									placeholder=" "
									value={geminiSafetySettings}
									onChange={onGeminiSafetySettingsChange}
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
										<button onClick={() => onRemoveMultiModel(index)}>Remove</button>
									</div>
								))}
								<button onClick={onAddMultiModel}>Add</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default observer(VQAAIConfigPopup);

export const vqaAIConfigPopupState = makeAutoObservable({
	visible: false,
	setVisible(visible: boolean) {
		this.visible = visible;
	},
});
