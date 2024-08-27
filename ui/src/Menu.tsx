import { useObserver } from "mobx-react";
import add24Filled from "@iconify/icons-fluent/add-24-filled";
import arrowUpload24Filled from "@iconify/icons-fluent/arrow-upload-24-filled";
import info24Regular from "@iconify/icons-fluent/info-24-regular";
import arrowSwap24Filled from "@iconify/icons-fluent/arrow-swap-24-filled";
import arrowDownload4Filled from "@iconify/icons-fluent/arrow-download-24-filled";
import { Icon } from "@iconify/react";
import { tagListState } from "./state/TagList";
import React, { useEffect } from "react";
import { imageListState } from "./state/ImageList";
import {
	errorMessageState,
	imageInfoPopupState,
	uploadPopupState,
	windowState,
	WindowStates,
	imageResolutionState,
	imageHashToUrl,
} from "./state";
import { currentImageState } from "./state/CurrentImage";

function Menu() {
	const currentSearchText = useObserver(() => imageListState.currentSearch);
	const [searchText, setSearchText] = React.useState(currentSearchText);
	const currentImage = useObserver(() => currentImageState.image);
	const currentMode = useObserver(() => windowState.state);
	const currentImageResolution = useObserver(() => imageResolutionState.resolution);
	const searchHistory = useObserver(() => imageListState.searchHistory);

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
		imageInfoPopupState.setImageInfoPopupVisible(true);
	}

	function uploadClicked() {
		uploadPopupState.setUploadPopupVisible(true);
	}

	function toggleModeClicked() {
		if (currentMode === WindowStates.Tagging) {
			windowState.setWindowState(WindowStates.Captioning);
		} else {
			windowState.setWindowState(WindowStates.Tagging);
		}
	}

	function onResolutionChanged(event: React.ChangeEvent<HTMLSelectElement>) {
		const resolution = event.target.value === "" ? null : parseInt(event.target.value);

		imageResolutionState.setResolution(resolution);
	}

	const download_url = currentImage === null ? "" : imageHashToUrl(currentImage.hash);

	return (
		<div className="menu">
			<div className="menu-item">
				<a href={download_url} download className="menu-button">
					<Icon icon={arrowDownload4Filled} />
				</a>
			</div>
			<div className="menu-item">
				<select value={currentImageResolution?.toString() ?? ""} onChange={onResolutionChanged}>
					<option value="">Original</option>
					<option value="512">512</option>
					<option value="256">256</option>
				</select>
			</div>
			<div className="menu-item">
				<button className="menu-button" onClick={toggleModeClicked}>
					<Icon icon={arrowSwap24Filled} />
					<p>{currentMode === WindowStates.Tagging ? "Switch to Captioning Mode" : "Switch to Tagging Mode"}</p>
				</button>
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
		</div>
	);
}

export default Menu;
