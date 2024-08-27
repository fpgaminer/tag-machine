import { observer } from "mobx-react";
import { currentImageState } from "./state/CurrentImage";
import React, { useEffect, useState } from "react";
import { autorun } from "mobx";
import { captionImage, setImageTrainingPrompt, suggestCaption } from "./state";
import llama3Tokenizer, { Llama3Tokenizer } from "./llama3Tokenizer";
import { AutoTokenizer } from '@xenova/transformers';

const tokenizer = await AutoTokenizer.from_pretrained('openai/clip-vit-large-patch14');

enum CaptionMode {
	StandardCaption,
	TrainingPrompt,
}

function CaptionEditor() {
	const image = currentImageState.image;
	const imageCaption = image ? image.caption : null;
	const imageTrainingPrompt = image ? image.trainingPrompt : null;
	//const [caption, setCaption] = useState(imageCaption ? imageCaption : "");
	//const [tokenCnt, setTokenCnt] = useState(0);
	const [saving, setSaving] = useState(0);
	const [captionMode, setCaptionMode] = useState(CaptionMode.StandardCaption);
	const currentText = captionMode === CaptionMode.StandardCaption ? imageCaption : imageTrainingPrompt;
	const [localCaption, setLocalCaption] = useState(currentText ?? "");

	const tokens = llama3Tokenizer.encode(localCaption);

	const clip_tokens = tokenizer.encode(localCaption, null, { add_special_tokens: false });

	// Update the caption when the current image changes
	useEffect(
		() =>
			autorun(() => {
				const image = currentImageState.image;
				const imageCaption = image ? image.caption : null;
				const imageTrainingPrompt = image ? image.trainingPrompt : null;
				const currentText = captionMode === CaptionMode.StandardCaption ? imageCaption : imageTrainingPrompt;

				setLocalCaption(currentText ? currentText : "");
			}),
		[captionMode]
	);

	//const caption = currentImageState.image ? currentImageState.image.caption : "";

	//let contents = <p>Loading...</p>;

	/*if (caption !== null) {
		contents = <div>{caption}</div>;
	}*/

	async function onSaveClicked() {
		if (image === null) {
			console.error("No image selected, cannot save caption");
			return;
		}

		setSaving(1);
		if (captionMode === CaptionMode.StandardCaption) {
			await captionImage(image, localCaption);
		}
		else if (captionMode === CaptionMode.TrainingPrompt) {
			await setImageTrainingPrompt(image, localCaption);
		}
		//await captionImage(image, caption);
		setSaving(2);
		setTimeout(() => {
			setSaving(0);
		}, 1000);
	}

	function onRevertClicked() {
		if (image === null) {
			return;
		}

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
	}

	function onCaptionModeChange(event: React.ChangeEvent<HTMLSelectElement>) {
		setCaptionMode(parseInt(event.target.value) as CaptionMode);
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
					<button onClick={onSaveClicked}>{saving === 0 ? "Save" : saving === 1 ? "Saving..." : "Saved"}</button>
				</div>
			</div>
			<div className="remainingSpace captionEditor">
				<textarea value={localCaption} onChange={onCaptionChange} />
				<div className="tokenCount">{tokens.length} tokens, {clip_tokens.length} clip tokens</div>
			</div>
		</div>
	);
}

export default observer(CaptionEditor);