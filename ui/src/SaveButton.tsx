import React, { useState } from "react";

enum SaveButtonState {
	Idle = 0,
	Saving = 1,
	Saved = 2,
}

interface SaveButtonProps {
	isUnsaved: boolean;
	onSave: () => Promise<void>;
}

function SaveButton({ isUnsaved, onSave }: SaveButtonProps) {
	const [savingState, setSavingState] = useState<SaveButtonState>(SaveButtonState.Idle);

	let buttonText: string;
	if (savingState === SaveButtonState.Idle && isUnsaved) {
		buttonText = "Save";
	} else if (savingState === SaveButtonState.Idle) {
		buttonText = "Unchanged";
	} else if (savingState === SaveButtonState.Saving) {
		buttonText = "Saving...";
	} else {
		buttonText = "Saved!";
	}

	const handleClick = async () => {
		setSavingState(SaveButtonState.Saving);
		await onSave();
		setSavingState(SaveButtonState.Saved);
		setTimeout(() => {
			setSavingState(SaveButtonState.Idle);
		}, 1000);
	};

	return (
		<button onClick={handleClick} disabled={!isUnsaved || savingState === SaveButtonState.Saving}>{buttonText}</button>
	);
}

export default SaveButton;