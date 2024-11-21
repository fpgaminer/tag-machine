import { makeAutoObservable, runInAction } from "mobx";
import { ImageObject, errorMessageState } from "../state";
import * as api from "../api";
import { currentImageState } from "./CurrentImage";

const MAX_SEARCH_HISTORY = 10;

class ImageListState {
	private _currentSearch: string = "";
	imagesById: Map<number, ImageObject> = new Map<number, ImageObject>();
	imagesByHash: Map<string, ImageObject> = new Map<string, ImageObject>();
	searchList: Uint32Array | null = null;
	searchHistory: Array<string> = new Array<string>();
	private version = 0; // Used to keep track of async search results
	initialSearchPerformed: boolean = false; // During initialization we wait until we're logged in, and then we can perform the initial search

	constructor() {
		this.searchHistory = JSON.parse(localStorage.getItem("searchHistory") ?? "[]") as string[];

		makeAutoObservable(this);
	}

	setCurrentSearch(search: string) {
		const changed = this._currentSearch != search;

		if (!changed) {
			return;
		}

		this._currentSearch = search;
		localStorage.setItem("currentSearch", search);

		// Clear the current image ID
		currentImageState.imageId = null;

		// Save search history
		if (this.searchHistory.includes(search)) {
			this.searchHistory.splice(this.searchHistory.indexOf(search), 1);
		}
		this.searchHistory.push(search);

		// Trim the search history
		while (this.searchHistory.length > MAX_SEARCH_HISTORY) {
			this.searchHistory.shift();
		}

		localStorage.setItem("searchHistory", JSON.stringify(this.searchHistory));

		// Clear the current search results
		this.searchList = null;
	}

	get currentSearch(): string {
		return this._currentSearch;
	}

	async performSearch() {
		runInAction(() => {
			this.version += 1;
		});

		const version = this.version;
		const search = this.currentSearch;
		console.log(`Performing search for search:${search} (version ${version})`);

		let searchResultIds: Uint32Array;
		try {
			if (search === "") {
				// While the server supports an empty search, in the UI it's probably just the initial state.
				// Since a blank search takes a long time to return, we'll just return an empty list.
				// If users really want all images, they can work around this by searching for a space.
				searchResultIds = new Uint32Array();
			} else {
				const result = await api.searchImages(["id"], null, search);

				if (result instanceof Uint32Array) {
					searchResultIds = result;
				} else {
					throw Error(`Unexpected search result type: ${result}`);
				}
			}
		} catch (error) {
			runInAction(() => {
				errorMessageState.setErrorMessage(`Error performing search: ${error as string}`);
			});
			return;
		}

		this.updateSearchList(version, search, searchResultIds);
	}

	updateSearchList(forVersion: number, search: string, results: Uint32Array) {
		if (forVersion != this.version) {
			console.log(`Ignoring search results for version ${forVersion} (current version is ${this.version})`);
			return;
		}

		console.log(`Updating search results for version ${forVersion}`);

		// Add the results to the search list
		this.searchList = results.slice();

		// Restore current image ID if it was saved and in the search results
		if (currentImageState.imageId === null) {
			const currentImageIdForSearch = JSON.parse(localStorage.getItem("currentImageIdForSearch") ?? "{}") as Record<
				string,
				string
			>;

			console.log(`Restoring current image ID for search: ${currentImageIdForSearch[search]}`);
			const image_id = currentImageIdForSearch !== undefined ? parseInt(currentImageIdForSearch[search]) : undefined;

			if (image_id !== undefined && this.searchList.includes(image_id)) {
				currentImageState.imageId = image_id;
			} else if (this.searchList.length > 0) {
				// If the image ID is not in the search results, just pick the first one
				console.log(`Image ID ${image_id} not in search results, picking first one`);
				currentImageState.imageId = this.searchList[0];
			} else {
				// No search results, leave the current image ID as null
				console.log(`No search results, leaving current image ID as null`);
			}
		}
	}

	addImageToCache(image: api.ApiImage) {
		let obj = this.imagesByHash.get(image.hash) ?? null;

		if (obj === null) {
			obj = new ImageObject(
				image.id,
				image.hash,
				new Map<number, number>(Object.entries(image.tags).map(([key, value]) => [Number(key), value])),
				new Map<string, Map<string, number>>(
					Object.entries(image.attributes).map(([outerKey, innerObj]) => [
						outerKey,
						new Map<string, number>(Object.entries(innerObj).map(([key, value]) => [key, value])),
					]),
				),
				image.active,
			);
			this.imagesById.set(image.id, obj);
			this.imagesByHash.set(image.hash, obj);
		}

		obj.merge(image);
	}

	getImageByHash(image_hash: string): ImageObject | null {
		return this.imagesByHash.get(image_hash) ?? null;
	}

	getImageById(image_id: number): ImageObject | null {
		return this.imagesById.get(image_id) ?? null;
	}

	async fetchImage(identifier: number | string) {
		let image: api.ApiImage | null;

		try {
			image = await api.getImageMetadata(identifier);
		} catch (error) {
			errorMessageState.setErrorMessage(`Error fetching image by hash: ${error as string}`);
			return null;
		}

		runInAction(() => {
			if (image !== null) {
				this.addImageToCache(image);
			}
		});
	}

	getSearchIndexById(image_id: number): number | null {
		const index = this.searchList?.indexOf(image_id);

		if (index === -1 || index === undefined) {
			return null;
		}

		return index;
	}

	getImageByIndex(index: number): ImageObject | null {
		if (this.searchList === null || index < 0 || index >= this.searchList.length) {
			return null;
		}

		const imageId = this.searchList[index];

		const image = this.imagesById.get(imageId);

		if (image === undefined) {
			return null;
		}

		return image;
	}

	getImageByIndexClamped(index: number): ImageObject | null {
		return this.searchList === null
			? null
			: this.getImageByIndex(Math.min(Math.max(0, index), this.searchList.length - 1));
	}

	getImageIdByIndexClamped(index: number): number | null {
		if (this.searchList === null || this.searchList.length === 0) {
			return null;
		}

		const clamped = Math.min(Math.max(0, index), this.searchList.length - 1);

		return this.searchList[clamped];
	}

	setInitialSearchPerformed() {
		this.initialSearchPerformed = true;
	}
}

export const imageListState = new ImageListState();
