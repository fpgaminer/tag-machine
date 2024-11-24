import { errorMessageState, popupsState, PopupStates } from "./state";
import { observer } from "mobx-react";
import { useRef, useState } from "react";
import * as api from "./api";
import useLocalStorageState from "./useLocalStateStorage";
import Popup from "./Popup";

function UploadPopup() {
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [source, setSource] = useLocalStorageState("upload-source", "misc");
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
		if (e.target.files && e.target.files.length > 0) {
			setSelectedFile(e.target.files[0]);
		}
	}

	function onSourceChanged(e: React.ChangeEvent<HTMLInputElement>) {
		setSource(e.target.value);
	}

	async function onUploadClicked() {
		if (selectedFile === null) {
			return;
		}

		// Get the hash of the file
		const file_hash = await getFileHash(selectedFile);

		// Upload the image
		try {
			await api.uploadImage(selectedFile);
		} catch (e) {
			errorMessageState.setErrorMessage(`Failed to upload image: ${e as string}`);
			return;
		}

		// Set the source
		if (source != "") {
			try {
				await api.addImageAttribute(file_hash, "source", source, false);
			} catch (e) {
				errorMessageState.setErrorMessage(`Failed to set source: ${e as string}`);
				return;
			}
		}

		alert("Image uploaded");
	}

	function onDragOver(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
	}

	function onDrop(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			setSelectedFile(e.dataTransfer.files[0]);
		}
	}

	function handleDropzoneClick() {
		fileInputRef.current?.click();
	}

	function handleDropzoneClose(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		setSelectedFile(null);
		e.stopPropagation();
		e.preventDefault();
		return false;
	}

	return (
		<Popup
			onClose={() => popupsState.removePopup(PopupStates.Upload)}
			title="Upload Image"
			className="upload-popup"
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<div className="upload-popup-body-content">
				<div className="upload-popup-body-content-dropzone" onClick={handleDropzoneClick}>
					<div className="dropzone-close" onClick={handleDropzoneClose}>
						X
					</div>
					{selectedFile ? (
						<img src={URL.createObjectURL(selectedFile)} />
					) : (
						<p>
							<b>Choose a file</b>
							<br /> or drag it here
						</p>
					)}
					<input type="file" accept="image/*" onChange={onFileSelected} ref={fileInputRef} />
				</div>
				<div>
					Source: <input type="text" placeholder="Source" value={source} onChange={onSourceChanged} />
				</div>
				<button onClick={onUploadClicked}>Upload</button>
			</div>
		</Popup>
	);
}

async function getFileHash(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

	return hashHex;
}

export default observer(UploadPopup);
