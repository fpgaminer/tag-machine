import { observer } from "mobx-react";
import { currentImageState } from "./state/CurrentImage";
import React, { useEffect, useState } from "react";
import { autorun } from "mobx";
import { captionImage, setImageTrainingPrompt, suggestCaption } from "./state";
import llama3Tokenizer, { Llama3Tokenizer } from "./llama3Tokenizer";
import { AutoTokenizer } from '@xenova/transformers';

const tokenizer = await AutoTokenizer.from_pretrained('openai/clip-vit-large-patch14');

enum CaptionMode {
	StandardCaption = "StandardCaption",
	TrainingPrompt = "TrainingPrompt",
}

enum SaveButtonState {
	Idle = 0,
	Saving = 1,
	Saved = 2,
}

function CaptionEditor() {
	// The current image and its captions (according to the server)
	const image = currentImageState.image;
	const imageCaption = image ? image.caption : null;
	const imageTrainingPrompt = image ? image.trainingPrompt : null;

	// Save button state
	const [saving, setSaving] = useState(SaveButtonState.Idle);

	// Caption mode
	const [captionMode, setCaptionMode] = useState(getSavedCaptionMode());

	// Image caption based on the current caption mode
	const currentText = captionMode === CaptionMode.StandardCaption ? imageCaption : imageTrainingPrompt;

	// User edits are saved temporarily to localStorage, fetch it if it exists
	const localStorageCaption = (image !== null) ? getLocalStorageCaption(image.id, captionMode) : null;

	// If the user has unsaved edits, use that as the caption text
	const revertCaptionText = localStorageCaption ?? currentText ?? "";

	// Our local text state
	const [localCaption, setLocalCaption] = useState(revertCaptionText);

	// Check if the local caption is different from the current caption (and thus unsaved)
	const isUnsaved = localCaption != (currentText ?? "");

	// Count tokens
	const tokens = llama3Tokenizer.encode(localCaption, undefined);
	const clip_tokens = tokenizer.encode(localCaption, null, { add_special_tokens: false });

	// Update the caption when the current image changes
	useEffect(
		() =>
			autorun(() => {
				const image = currentImageState.image;
				const imageCaption = image ? image.caption : null;
				const imageTrainingPrompt = image ? image.trainingPrompt : null;
				const currentText = captionMode === CaptionMode.StandardCaption ? imageCaption : imageTrainingPrompt;
				const localStorageCaption = (image !== null) ? getLocalStorageCaption(image.id, captionMode) : null;
				const revertCaptionText = localStorageCaption ?? currentText ?? "";

				setLocalCaption(revertCaptionText);
			}),
		[captionMode]
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
			await captionImage(image, localCaption);
		}
		else if (captionMode === CaptionMode.TrainingPrompt) {
			await setImageTrainingPrompt(image, localCaption);
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

		const suggestion = await suggestCaption(image);

		if (suggestion !== null) {
			setLocalCaption(suggestion);
		}
	}

	function onCaptionChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
		setLocalCaption(event.target.value);

		if (image !== null) {
			if (event.target.value === currentText) {
				clearLocalStorageCaption(image.id, captionMode);
			}
			else {
				saveLocalStorageCaption(image.id, captionMode, event.target.value);
			}
		}
	}

	function onCaptionModeChange(event: React.ChangeEvent<HTMLSelectElement>) {
		const new_mode = CaptionMode[event.target.value as keyof typeof CaptionMode];
		setCaptionMode(new_mode);
		localStorage.setItem("captionMode", new_mode);
	}

	let saveButtonText;

	if (saving === SaveButtonState.Idle && isUnsaved) {
		saveButtonText = "Save";
	}
	else if (saving === SaveButtonState.Idle) {
		saveButtonText = "Unchanged";
	}
	else if (saving === SaveButtonState.Saving) {
		saveButtonText = "Saving...";
	}
	else if (saving === SaveButtonState.Saved) {
		saveButtonText = "Saved";
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Caption</h3>
				<div className="columnHeaderButtons">
					<select value={captionMode} onChange={onCaptionModeChange}>
						<option value={CaptionMode.StandardCaption}>Standard Caption</option>
						<option value={CaptionMode.TrainingPrompt}>Training Prompt</option>
					</select>
					<button onClick={onSuggestClicked}>Suggest</button>
					<button onClick={onRevertClicked}>Revert</button>
					<button onClick={onSaveClicked}>{saveButtonText}</button>
				</div>
			</div>
			<div className="remainingSpace captionEditor">
				<textarea value={localCaption} onChange={onCaptionChange} />
				<div className="tokenCount">{tokens.length} tokens, {clip_tokens.length} clip tokens</div>
			</div>
		</div>
	);
}

function getSavedCaptionMode(): CaptionMode {
	const savedMode = localStorage.getItem("captionMode");

	if (savedMode === null) {
		return CaptionMode.StandardCaption;
	}
	
	return Object.values(CaptionMode).includes(savedMode as CaptionMode) ? savedMode as CaptionMode : CaptionMode.StandardCaption;
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

export default observer(CaptionEditor);
