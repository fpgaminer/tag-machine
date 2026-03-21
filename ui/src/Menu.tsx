import { useObserver } from "mobx-react";
import { Icon } from "@iconify-icon/react";
import { tagListState } from "./state/TagList";
import React, { useEffect } from "react";
import { imageListState } from "./state/ImageList";
import {
	errorMessageState,
	windowState,
	WindowStates,
	imageResolutionState,
	popupsState,
	PopupStates,
	imageIdToUrl,
} from "./state";
import { currentImageState } from "./state/CurrentImage";
import { API_URL, authenticatedFetch } from "./api";
import { imageInfoPopupState } from "./ImageInfoPopup";

function Menu() {
	const currentSearchText = useObserver(() => imageListState.currentSearch);
	const [searchText, setSearchText] = React.useState(currentSearchText);
	const currentImage = useObserver(() => currentImageState.displayedImage);
	const currentMode = useObserver(() => windowState.state);
	const currentModeValue = currentMode ?? WindowStates.Tagging;
	const currentImageResolution = useObserver(() => imageResolutionState.resolution);
	const searchHistory = useObserver(() => imageListState.searchHistory);
	const showSearch = currentMode !== WindowStates.VqaTasks;

	useEffect(() => {
		setSearchText(currentSearchText);
	}, [currentSearchText]);

	async function onAddTagClicked() {
		const tagName = prompt("Enter tag name");

		if (tagName === null || tagName == "") {
			return;
		}

		await tagListState.addTag(tagName);
	}

	function searchClicked() {
		try {
			imageListState.setCurrentSearch(searchText);
		} catch (e) {
			errorMessageState.setErrorMessage(`Invalid search: ${e as string}`);
			return;
		}

		void imageListState.performSearch();
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter") {
			searchClicked();
		}
	}

	function imageInfoClicked() {
		imageInfoPopupState.setImage(currentImage);
		popupsState.addPopup(PopupStates.ImageInfo);
	}

	function uploadClicked() {
		popupsState.addPopup(PopupStates.Upload);
	}

	function onModeChanged(event: React.ChangeEvent<HTMLSelectElement>) {
		const newMode = event.target.value as WindowStates;
		windowState.setWindowState(newMode);
	}

	function onResolutionChanged(event: React.ChangeEvent<HTMLSelectElement>) {
		const resolution = event.target.value === "" ? null : parseInt(event.target.value);

		imageResolutionState.setResolution(resolution);
	}

	async function onDownloadClicked() {
		if (currentImage === null) {
			return;
		}

		try {
			await downloadImage(currentImage.hash);
		} catch (e) {
			errorMessageState.setErrorMessage(`Failed to download image: ${e as string}`);
		}
	}

	async function onCopyClicked() {
		if (currentImage === null) {
			return;
		}

		try {
			await copyImage(currentImage.id, currentImageResolution);
		} catch (e) {
			errorMessageState.setErrorMessage(`Failed to copy image: ${e as string}`);
		}
	}

	function userSettingsClicked(event: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
		if (event.altKey) {
			popupsState.addPopup(PopupStates.AdminPanel);
		} else {
			popupsState.addPopup(PopupStates.UserSettings);
		}
	}

	return (
		<div className="menu">
			<div className="menu-item logo">
				<img src="/icon2.svg" alt="Website Logo" />
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={onDownloadClicked}>
					<Icon icon="fluent:arrow-download-24-filled" />
				</button>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={onCopyClicked}>
					<Icon icon="fluent:copy-24-filled" />
				</button>
			</div>
			<div className="menu-item">
				<select value={currentImageResolution?.toString() ?? ""} onChange={onResolutionChanged}>
					<option value="">Original</option>
					<option value="512">512</option>
					<option value="256">256</option>
				</select>
			</div>
			<div className="menu-item">
				<select value={currentModeValue} onChange={onModeChanged}>
					<option value={WindowStates.Tagging}>Tagging Mode</option>
					<option value={WindowStates.Captioning}>Captioning Mode</option>
					<option value={WindowStates.Vqa}>VQA Mode</option>
					<option value={WindowStates.VqaTasks}>VQA Task Mode</option>
					<option value={WindowStates.BoundingBox}>Bounding Box Mode</option>
				</select>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={uploadClicked}>
					<Icon icon="fluent:arrow-upload-24-filled" />
					<p>Upload</p>
				</button>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={imageInfoClicked}>
					<Icon icon="fluent:info-24-regular" />
					<p>Image Info</p>
				</button>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={onAddTagClicked}>
					<Icon icon="fluent:add-24-filled" />
					<p>Add Tag</p>
				</button>
			</div>
			{showSearch ? (
				<div className="menu-item">
					<input
						placeholder="Search"
						value={searchText}
						onChange={(e) => setSearchText(e.target.value)}
						onKeyDown={handleKeyDown}
						list="search-history"
					/>
					<datalist id="search-history">
						{searchHistory.map((search, index) => (
							<option key={index} value={search} />
						))}
					</datalist>
					<button className="menu-button" onClick={searchClicked}>
						Search
					</button>
				</div>
			) : null}
			<div className="menu-item">
				<button className="menu-button" onClick={userSettingsClicked}>
					<Icon icon="fluent:settings-24-regular" />
				</button>
			</div>
		</div>
	);
}

async function downloadImage(hash: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${hash}`);

	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
	}

	const blob = await response.blob();
	const url = window.URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = hash;
	document.body.appendChild(a);
	a.click();
	window.URL.revokeObjectURL(url);
	a.remove();
}

async function copyImage(imageId: number, resolution: number | null): Promise<void> {
	if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
		throw new Error("Image clipboard copy is not supported in this browser");
	}

	let url = imageIdToUrl(imageId);
	if (resolution !== null) {
		url += `?size=${resolution}`;
	}

	const response = await authenticatedFetch(url);

	if (!response.ok) {
		throw new Error(`Failed to copy image: ${response.status} ${response.statusText}`);
	}

	const blob = await response.blob();
	const clipboardBlob = await getClipboardCompatibleImage(blob);
	const mimeType = clipboardBlob.type || "image/png";

	await navigator.clipboard.write([
		new ClipboardItem({
			[mimeType]: clipboardBlob,
		}),
	]);
}

async function getClipboardCompatibleImage(blob: Blob): Promise<Blob> {
	if (blob.type === "image/png") {
		return blob;
	}

	return await convertImageBlobToPng(blob);
}

async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
	const objectUrl = URL.createObjectURL(blob);

	try {
		const image = await loadImage(objectUrl);
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;

		const context = canvas.getContext("2d");
		if (context === null) {
			throw new Error("Failed to create canvas context for clipboard copy");
		}

		context.drawImage(image, 0, 0);

		const pngBlob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/png");
		});

		if (pngBlob === null) {
			throw new Error("Failed to convert image for clipboard copy");
		}

		return pngBlob;
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Failed to load image for clipboard copy"));
		image.src = src;
	});
}

export default Menu;
