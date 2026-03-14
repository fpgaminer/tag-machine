import { errorMessageState, popupsState, PopupStates } from "./state";
import { observer } from "mobx-react";
import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import useLocalStorageState from "./useLocalStateStorage";
import Popup from "./Popup";
import { imageListState } from "./state/ImageList";

type UploadStatus = {
	type: "success" | "warning" | "error";
	message: string;
} | null;

function UploadPopup() {
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [source, setSource] = useLocalStorageState("upload-source", "misc");
	const [isUploading, setIsUploading] = useState(false);
	const [uploadStatus, setUploadStatus] = useState<UploadStatus>(null);
	const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const selectedFilesRef = useRef<File[]>([]);

	useEffect(() => {
		selectedFilesRef.current = selectedFiles;
	}, [selectedFiles]);

	useEffect(() => {
		if (selectedFiles.length !== 1) {
			setPreviewUrl(null);
			return;
		}

		const url = URL.createObjectURL(selectedFiles[0]);
		setPreviewUrl(url);

		return () => {
			URL.revokeObjectURL(url);
		};
	}, [selectedFiles]);

	function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
		if (isUploading) {
			e.target.value = "";
			return;
		}

		if (e.target.files) {
			addFiles(e.target.files);
			e.target.value = "";
		}
	}

	function addFiles(files: FileList | File[]) {
		const incomingFiles = Array.from(files);
		const validFiles = incomingFiles.filter(isImageFile);
		const skippedFileCount = incomingFiles.length - validFiles.length;

		if (validFiles.length === 0) {
			setUploadStatus({
				type: "error",
				message: skippedFileCount > 0 ? "Only image files can be uploaded." : "No files were selected.",
			});
			return;
		}

		const mergedFiles = [...selectedFilesRef.current];
		let duplicateCount = 0;

		for (const file of validFiles) {
			const alreadySelected = mergedFiles.some((existingFile) => filesMatch(existingFile, file));
			if (alreadySelected) {
				duplicateCount += 1;
				continue;
			}

			mergedFiles.push(file);
		}

		const statusParts: string[] = [];
		if (skippedFileCount > 0) {
			statusParts.push(`${skippedFileCount} non-image file${skippedFileCount === 1 ? "" : "s"} skipped.`);
		}
		if (duplicateCount > 0) {
			statusParts.push(`${duplicateCount} duplicate file${duplicateCount === 1 ? "" : "s"} ignored.`);
		}

		setSelectedFiles(mergedFiles);
		setUploadStatus(
			statusParts.length > 0
				? {
						type: "warning",
						message: statusParts.join(" "),
					}
				: null,
		);
	}

	function onSourceChanged(e: React.ChangeEvent<HTMLInputElement>) {
		setSource(e.target.value);
	}

	async function onUploadClicked() {
		if (selectedFiles.length === 0 || isUploading) {
			return;
		}

		setIsUploading(true);
		setUploadStatus(null);
		setUploadProgress({ current: 0, total: selectedFiles.length });

		const trimmedSource = source.trim();
		const uploadFailures: { file: File; reason: string }[] = [];
		const sourceFailures: { name: string; reason: string }[] = [];
		let uploadedCount = 0;

		for (const [index, file] of selectedFiles.entries()) {
			setUploadProgress({ current: index + 1, total: selectedFiles.length });

			try {
				const fileHash = await getFileHash(file);
				await api.uploadImage(file);
				uploadedCount += 1;

				if (trimmedSource !== "") {
					try {
						await api.addImageAttribute(fileHash, "source", trimmedSource, false);
					} catch (error) {
						sourceFailures.push({
							name: file.name,
							reason: error instanceof Error ? error.message : String(error),
						});
					}
				}
			} catch (error) {
				uploadFailures.push({
					file,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}

		setIsUploading(false);

		if (uploadedCount > 0 && imageListState.currentSearch !== "") {
			void imageListState.performSearch();
		}

		setSelectedFiles(uploadFailures.map(({ file }) => file));
		clearFileInput();

		if (uploadFailures.length === 0 && sourceFailures.length === 0) {
			setUploadStatus({
				type: "success",
				message: `Uploaded ${uploadedCount} image${uploadedCount === 1 ? "" : "s"}.`,
			});
			return;
		}

		const summary: string[] = [];
		if (uploadedCount > 0) {
			summary.push(`Uploaded ${uploadedCount} image${uploadedCount === 1 ? "" : "s"}.`);
		}
		if (uploadFailures.length > 0) {
			summary.push(
				`${uploadFailures.length} upload${uploadFailures.length === 1 ? "" : "s"} failed: ${uploadFailures
					.map(({ file, reason }) => `${file.name} (${reason})`)
					.join(", ")}`,
			);
		}
		if (sourceFailures.length > 0) {
			summary.push(
				`Source metadata failed on ${sourceFailures.length} image${sourceFailures.length === 1 ? "" : "s"}: ${sourceFailures
					.map(({ name, reason }) => `${name} (${reason})`)
					.join(", ")}`,
			);
		}

		setUploadStatus({
			type: uploadedCount > 0 ? "warning" : "error",
			message: summary.join(" "),
		});

		if (uploadFailures.length > 0) {
			errorMessageState.setErrorMessage(
				`Failed to upload ${uploadFailures.length} file${uploadFailures.length === 1 ? "" : "s"}.`,
			);
		}
	}

	function onDragOver(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
	}

	function onDrop(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		if (isUploading) {
			return;
		}

		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			addFiles(e.dataTransfer.files);
		}
	}

	function handleDropzoneClick() {
		if (isUploading) {
			return;
		}

		fileInputRef.current?.click();
	}

	function handleSelectionClear(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
		e.stopPropagation();
		e.preventDefault();
		setSelectedFiles([]);
		setUploadStatus(null);
		clearFileInput();
	}

	function clearFileInput() {
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	}

	return (
		<Popup
			onClose={() => {
				if (!isUploading) {
					popupsState.removePopup(PopupStates.Upload);
				}
			}}
			title="Upload Images"
			className="upload-popup"
			onDragOver={onDragOver}
			onDrop={onDrop}
		>
			<div className="popup-window-body-content">
				<div className="upload-popup-body-content-dropzone" onClick={handleDropzoneClick}>
					{selectedFiles.length > 0 ? (
						<button
							type="button"
							className="dropzone-close"
							onClick={handleSelectionClear}
							disabled={isUploading}
							aria-label="Clear selected files"
						>
							&times;
						</button>
					) : null}
					{selectedFiles.length === 0 ? (
						<p>
							<b>Choose files</b>
							<br /> or drag them here
						</p>
					) : selectedFiles.length === 1 && previewUrl !== null ? (
						<div className="upload-popup-selection upload-popup-selection-single">
							<img src={previewUrl} alt={selectedFiles[0].name} />
							<div className="upload-popup-selection-summary">
								<strong>{selectedFiles[0].name}</strong>
							</div>
						</div>
					) : (
						<div className="upload-popup-selection">
							<div className="upload-popup-selection-summary">
								<strong>
									{selectedFiles.length} image{selectedFiles.length === 1 ? "" : "s"} selected
								</strong>
								<span>Click or drop more images to add to this batch.</span>
							</div>
							<div className="upload-popup-selection-list">
								{selectedFiles.map((file) => (
									<div key={fileKey(file)} className="upload-popup-selection-item">
										{file.name}
									</div>
								))}
							</div>
						</div>
					)}
					<input type="file" accept="image/*" multiple onChange={onFileSelected} ref={fileInputRef} />
				</div>
				<label className="upload-popup-source">
					<span>Source</span>
					<input type="text" placeholder="Source" value={source} onChange={onSourceChanged} disabled={isUploading} />
				</label>
				{isUploading ? (
					<div className="upload-popup-progress">
						Uploading {uploadProgress.current} of {uploadProgress.total}
					</div>
				) : null}
				{uploadStatus !== null ? (
					<div className={`upload-popup-status upload-popup-status-${uploadStatus.type}`}>{uploadStatus.message}</div>
				) : null}
				<button onClick={onUploadClicked} disabled={selectedFiles.length === 0 || isUploading}>
					{isUploading
						? "Uploading..."
						: `Upload ${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"}`}
				</button>
			</div>
		</Popup>
	);
}

function fileKey(file: File): string {
	return `${file.name}-${file.size}-${file.lastModified}`;
}

function filesMatch(a: File, b: File): boolean {
	return fileKey(a) === fileKey(b);
}

function isImageFile(file: File): boolean {
	if (file.type.startsWith("image/")) {
		return true;
	}

	return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i.test(file.name);
}

async function getFileHash(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

	return hashHex;
}

export default observer(UploadPopup);
