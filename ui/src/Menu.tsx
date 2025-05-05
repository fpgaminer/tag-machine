import { useObserver } from "mobx-react";
import add24Filled from "@iconify/icons-fluent/add-24-filled";
import arrowUpload24Filled from "@iconify/icons-fluent/arrow-upload-24-filled";
import info24Regular from "@iconify/icons-fluent/info-24-regular";
import arrowDownload4Filled from "@iconify/icons-fluent/arrow-download-24-filled";
import settings24Regular from "@iconify/icons-fluent/settings-24-regular";
import { Icon } from "@iconify/react";
import { tagListState } from "./state/TagList";
import React, { useEffect } from "react";
import { imageListState } from "./state/ImageList";
import { errorMessageState, windowState, WindowStates, imageResolutionState, popupsState, PopupStates } from "./state";
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
					<Icon icon={arrowDownload4Filled} />
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
					<Icon icon={arrowUpload24Filled} />
					<p>Upload</p>
				</button>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={imageInfoClicked}>
					<Icon icon={info24Regular} />
					<p>Image Info</p>
				</button>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={onAddTagClicked}>
					<Icon icon={add24Filled} />
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
					<Icon icon={settings24Regular} />
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

export default Menu;
