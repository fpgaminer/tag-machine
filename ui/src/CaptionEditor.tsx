import { observer } from "mobx-react";
import { currentImageState } from "./state/CurrentImage";
import React, { useEffect, useState } from "react";
import { autorun } from "mobx";
import { addImageAttribute, suggestCaption } from "./state";
import { AutoTokenizer } from "@xenova/transformers";
import { tokenizeString } from "./Llama3TokenizerProxy";

const tokenizer = await AutoTokenizer.from_pretrained("openai/clip-vit-large-patch14");

enum CaptionMode {
	StandardCaption = "StandardCaption",
	TrainingPrompt = "TrainingPrompt",
}

type CaptionType = "descriptive" | "training_prompt" | "rng-tags";
type CaptionTone = "formal" | "informal";
type CaptionLength = "very short" | "short" | "medium-length" | "long" | "very long" | number | null;

enum SaveButtonState {
	Idle = 0,
	Saving = 1,
	Saved = 2,
}

const CAPTION_TYPE_MAP: {
	[key: string]: string[];
} = {
	"descriptive,formal,false,false": ["Write a descriptive caption for this image in a formal tone."],
	"descriptive,formal,false,true": [
		"Write a descriptive caption for this image in a formal tone within {word_count} words.",
	],
	"descriptive,formal,true,false": ["Write a {length} descriptive caption for this image in a formal tone."],
	"descriptive,informal,false,false": ["Write a descriptive caption for this image in a casual tone."],
	"descriptive,informal,false,true": [
		"Write a descriptive caption for this image in a casual tone within {word_count} words.",
	],
	"descriptive,informal,true,false": ["Write a {length} descriptive caption for this image in a casual tone."],

	"training_prompt,formal,false,false": ["Write a stable diffusion prompt for this image."],
	"training_prompt,formal,false,true": ["Write a stable diffusion prompt for this image within {word_count} words."],
	"training_prompt,formal,true,false": ["Write a {length} stable diffusion prompt for this image."],

	"rng-tags,formal,false,false": ["Write a list of Booru tags for this image."],
	"rng-tags,formal,false,true": ["Write a list of Booru tags for this image within {word_count} words."],
	"rng-tags,formal,true,false": ["Write a {length} list of Booru tags for this image."],
};

function CaptionEditor() {
	// The current image and its captions (according to the server)
	const image = currentImageState.image;
	const imageCaption = image ? image.singularAttribute("caption") : null;
	const imageTrainingPrompt = image ? image.trainingPrompt : null;
	const [captionTone, setCaptionTone] = useState<CaptionTone>("formal");
	const [captionLength, setCaptionLength] = useState<CaptionLength>(null);
	const [tokens, setTokens] = useState<string[]>([]);

	// Save button state
	const [saving, setSaving] = useState(SaveButtonState.Idle);

	// Caption mode
	const [captionMode, setCaptionMode] = useState(getSavedCaptionMode());

	// Image caption based on the current caption mode
	const currentText = captionMode === CaptionMode.StandardCaption ? imageCaption : imageTrainingPrompt;

	// User edits are saved temporarily to localStorage, fetch it if it exists
	const localStorageCaption = image !== null ? getLocalStorageCaption(image.id, captionMode) : null;

	// If the user has unsaved edits, use that as the caption text
	const revertCaptionText = localStorageCaption ?? currentText ?? "";

	// Our local text state
	const [localCaption, setLocalCaption] = useState(revertCaptionText);

	// Check if the local caption is different from the current caption (and thus unsaved)
	const isUnsaved = localCaption != (currentText ?? "");

	// Count tokens
	const clip_tokens = tokenizer.encode(localCaption, null, { add_special_tokens: false });

	useEffect(() => {
		const text = localCaption;
		const fetchTokens = async () => {
			try {
				const { resultText, resultTokens } = await tokenizeString(text);
				if (resultText === text) {
					setTokens(resultTokens);
					return;
				}
			} catch (e) {
				console.error(e);
			}
		};

		void fetchTokens();
	}, [localCaption]);

	// Update the caption when the current image changes
	useEffect(
		() =>
			autorun(() => {
				const image = currentImageState.image;
				const imageCaption = image ? image.singularAttribute("caption") : null;
				const imageTrainingPrompt = image ? image.trainingPrompt : null;
				const currentText = captionMode === CaptionMode.StandardCaption ? imageCaption : imageTrainingPrompt;
				const localStorageCaption = image !== null ? getLocalStorageCaption(image.id, captionMode) : null;
				const revertCaptionText = localStorageCaption ?? currentText ?? "";

				setLocalCaption(revertCaptionText);
			}),
		[captionMode],
	);

	async function onSaveClicked() {
		if (image === null) {
			console.error("No image selected, cannot save caption");
			return;
		}

		// Set state to saving
		setSaving(SaveButtonState.Saving);

		// Save the caption to the server
		if (captionMode === CaptionMode.StandardCaption) {
			await addImageAttribute(image.id, "caption", localCaption, true);
		} else if (captionMode === CaptionMode.TrainingPrompt) {
			await addImageAttribute(image.id, "training_prompt", localCaption, true);
		}

		// Set state to saved and clear after a delay
		setSaving(SaveButtonState.Saved);
		setTimeout(() => {
			setSaving(SaveButtonState.Idle);
		}, 1000);

		// Clear the local storage caption
		clearLocalStorageCaption(image.id, captionMode);
	}

	function onRevertClicked() {
		// Revert to the server caption
		if (image === null) {
			return;
		}

		clearLocalStorageCaption(image.id, captionMode);
		setLocalCaption(currentText ?? "");
	}

	async function onSuggestClicked() {
		if (image === null) {
			return;
		}

		const caption_type = captionMode === CaptionMode.StandardCaption ? "descriptive" : "training_prompt";

		const prompt = formatCaptionPrompt(caption_type, captionTone, captionLength);
		console.log(`Using prompt: ${prompt}`);

		const suggestion = await suggestCaption(image, prompt);

		if (suggestion !== null) {
			setLocalCaption(suggestion);
		}
	}

	function onCaptionChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
		setLocalCaption(event.target.value);

		if (image !== null) {
			if (event.target.value === currentText) {
				clearLocalStorageCaption(image.id, captionMode);
			} else {
				saveLocalStorageCaption(image.id, captionMode, event.target.value);
			}
		}
	}

	function onCaptionModeChange(event: React.ChangeEvent<HTMLSelectElement>) {
		const new_mode = CaptionMode[event.target.value as keyof typeof CaptionMode];
		setCaptionMode(new_mode);
		localStorage.setItem("captionMode", new_mode);

		if (new_mode !== CaptionMode.StandardCaption) {
			// Force the caption tone to formal for training prompts
			setCaptionTone("formal");
		}
	}

	function onCaptionToneChange(event: React.ChangeEvent<HTMLSelectElement>) {
		setCaptionTone(event.target.value as CaptionTone);
	}

	function onCaptionLengthChange(event: React.ChangeEvent<HTMLSelectElement>) {
		const value = event.target.value;
		if (value === "") {
			setCaptionLength(null);
		} else if (!isNaN(Number(value))) {
			setCaptionLength(Number(value));
		} else {
			setCaptionLength(value as CaptionLength);
		}
	}

	let saveButtonText;

	if (saving === SaveButtonState.Idle && isUnsaved) {
		saveButtonText = "Save";
	} else if (saving === SaveButtonState.Idle) {
		saveButtonText = "Unchanged";
	} else if (saving === SaveButtonState.Saving) {
		saveButtonText = "Saving...";
	} else if (saving === SaveButtonState.Saved) {
		saveButtonText = "Saved";
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Caption</h3>
				<div className="columnHeaderButtons captionEditorButtons">
					<select value={captionMode} onChange={onCaptionModeChange}>
						<option value={CaptionMode.StandardCaption}>Standard Caption</option>
						<option value={CaptionMode.TrainingPrompt}>Training Prompt</option>
					</select>

					{/* Caption Tone Dropdown */}
					<select
						value={captionTone}
						onChange={onCaptionToneChange}
						disabled={captionMode !== CaptionMode.StandardCaption}
					>
						<option value="formal">Formal</option>
						{captionMode === CaptionMode.StandardCaption && <option value="informal">Informal</option>}
					</select>

					{/* Caption Length Dropdown */}
					<select value={captionLength ?? ""} onChange={onCaptionLengthChange}>
						<option value="">Any length</option>
						<option value="very short">Very short</option>
						<option value="short">Short</option>
						<option value="medium-length">Medium-length</option>
						<option value="long">Long</option>
						<option value="very long">Very long</option>
						{Array.from({ length: 25 }, (_, i) => 20 + i * 10).map((num) => (
							<option key={num} value={num}>
								{num} words
							</option>
						))}
					</select>

					<button onClick={onSuggestClicked}>Suggest</button>
					<button onClick={onRevertClicked}>Revert</button>
					<button onClick={onSaveClicked}>{saveButtonText}</button>
				</div>
			</div>
			<div className="remainingSpace captionEditor">
				<textarea value={localCaption} onChange={onCaptionChange} />
				<div className="tokenCount">
					{tokens.length} tokens, {clip_tokens.length} clip tokens
				</div>
			</div>
		</div>
	);
}

function getSavedCaptionMode(): CaptionMode {
	const savedMode = localStorage.getItem("captionMode");

	if (savedMode === null) {
		return CaptionMode.StandardCaption;
	}

	return Object.values(CaptionMode).includes(savedMode as CaptionMode)
		? (savedMode as CaptionMode)
		: CaptionMode.StandardCaption;
}

function clearLocalStorageCaption(imageId: number, captionMode: CaptionMode) {
	const k = `userCaptionEdits-${imageId}-${captionMode}`;
	localStorage.removeItem(k);
}

function saveLocalStorageCaption(imageId: number, captionMode: CaptionMode, caption: string) {
	const k = `userCaptionEdits-${imageId}-${captionMode}`;
	localStorage.setItem(k, caption);
}

function getLocalStorageCaption(imageId: number, captionMode: CaptionMode): string | null {
	const k = `userCaptionEdits-${imageId}-${captionMode}`;
	return localStorage.getItem(k);
}

function formatString(template: string, values: { [key: string]: string }): string {
	return template.replace(/\{(\w+)\}/g, (match, key) => {
		return key in values ? values[key] : match;
	});
}

function formatCaptionPrompt(captionType: string, captionTone: string, captionLength: string | number | null): string {
	const promptKey = `${captionType},${captionTone},${typeof captionLength === "string" ? "true" : "false"},${typeof captionLength === "number" ? "true" : "false"}`;

	if (!(promptKey in CAPTION_TYPE_MAP)) {
		throw new Error(`Invalid caption prompt key: ${promptKey}`);
	}

	const template = CAPTION_TYPE_MAP[promptKey][0];
	const values = {
		word_count: captionLength?.toString() ?? "",
		length: captionLength?.toString() ?? "",
	};
	const formatted = formatString(template, values);

	return formatted;
}

export default observer(CaptionEditor);
