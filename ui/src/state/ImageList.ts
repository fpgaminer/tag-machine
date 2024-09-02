import { makeAutoObservable, runInAction } from "mobx";
import { ImageObject, errorMessageState } from "../state";
import * as api from "../api";
import grammar from "../grammar";
import nearley from "nearley";
import { currentImageState } from "./CurrentImage";

const MAX_SEARCH_HISTORY = 10;

interface ParsedSearch {
	search: string;
	operator: api.SearchOperator | null;
	orderBy: api.SearchOrderBy | null;
}

class ImageListState {
	private _currentSearch: ParsedSearch = {
		search: "",
		operator: null,
		orderBy: null,
	};
	imagesById: Map<number, ImageObject> = new Map<number, ImageObject>();
	imagesByHash: Map<string, ImageObject> = new Map<string, ImageObject>();
	searchList: Array<number> = new Array<number>();
	searchHistory: Array<string> = new Array<string>();
	private version = 0; // Used to track of async search results
	initialSearchPerformed: boolean = false; // During initialization we wait until we're logged in, and then we can perform the initial search

	constructor() {
		this.searchHistory = JSON.parse(localStorage.getItem("searchHistory") ?? "[]") as string[];

		makeAutoObservable(this);
	}

	setCurrentSearch(search: string) {
		const changed = this._currentSearch.search != search;

		if (!changed) {
			return;
		}

		// Parse
		const parsed = this.parseSearchString(search);

		this._currentSearch = parsed;
		localStorage.setItem("currentSearch", search);

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

		// Restore current image ID if it was saved
		const currentImageIdForSearch = JSON.parse(localStorage.getItem("currentImageIdForSearch") ?? "{}") as Record<
			string,
			string
		>;

		if (currentImageIdForSearch[search] !== undefined) {
			const image_id = parseInt(currentImageIdForSearch[search]);
			currentImageState.imageId = image_id;
		}

		// Clear the current cache of search results
		this.searchList.length = 0;
	}

	get currentSearch(): string {
		return this._currentSearch.search;
	}

	parseSearchString(search: string): ParsedSearch {
		search = search.trim();

		if (search === "") {
			return {
				search: "",
				operator: null,
				orderBy: null,
			};
		}

		const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
		parser.feed(search);

		if (parser.results.length === 0) {
			throw Error(`Failed to parse search string`);
		} else if (parser.results.length > 1) {
			throw Error(`Ambiguous search string`);
		}

		interface ParsedResult {
			expr: api.SearchOperator;
			sort: api.SearchOrderBy | null;
		}

		const parsed = parser.results[0] as ParsedResult;

		console.log(`Parsed search string: ${JSON.stringify(parsed)}`);

		return {
			search: search,
			operator: parsed.expr,
			orderBy: parsed.sort,
		};
	}

	/*async performSearch(minId: number | null, maxId: number | null, limit?: number) {
		const version = this.version;
		const limitValue = limit ?? IMAGE_LIST_FETCH_SIZE;
		let operator = this._currentSearch.operator;

		if (minId !== null) {
			const minIdOp: api.SearchOperator = { kind: "min_id", value: minId };
			operator = operator === null ? minIdOp : { kind: "and", value: [operator, minIdOp] };
		}

		if (maxId !== null) {
			const maxIdOp: api.SearchOperator = { kind: "max_id", value: maxId };
			operator = operator === null ? maxIdOp : { kind: "and", value: [operator, maxIdOp] };
		}

		console.log(
			`Performing search for search:${this._currentSearch.search} with minId ${minId ?? "null"}, maxID ${
				maxId ?? "null"
			}, and limit ${limitValue} (version ${version})`
		);

		const select: SearchSelect[] = ["id", "hash", "tags", "attributes", "active", "caption"];

		let searchResults: api.ApiSearchResults;
		try {
			searchResults = await api.searchImages(select, "id", limitValue, operator);
		} catch (error) {
			runInAction(() => {
				errorMessageState.setErrorMessage(`Error performing search: ${error as string}`);
			});
			return;
		}

		this.updateSearchList(version, searchResults);
	}*/

	async performSearch() {
		const version = this.version;
		console.log(`Performing search for search:${this._currentSearch.search} (version ${version})`);

		const orderBy = this._currentSearch.orderBy ?? "id";

		let searchResults: api.ApiSearchResults;
		try {
			searchResults = await api.searchImages(["id"], orderBy, null, this._currentSearch.operator);
		} catch (error) {
			runInAction(() => {
				errorMessageState.setErrorMessage(`Error performing search: ${error as string}`);
			});
			return;
		}

		this.updateSearchList(version, searchResults);
	}

	updateSearchList(forVersion: number, results: api.ApiSearchResults) {
		if (forVersion != this.version) {
			console.log(`Ignoring search results for version ${forVersion} (current version is ${this.version})`);
			return;
		}

		console.log(`Updating search results for version ${forVersion}`);

		this.version += 1;
		this.searchList.length = 0;

		if (results.id === undefined) {
			throw Error(`Search results missing id list`);
		}

		// Sort the results
		//results.id.sort((a, b) => a - b);

		// Add the results to the search list
		for (const image_id of results.id) {
			this.searchList.push(image_id);
		}

		/*for (const image of results.images) {
			if (
				image.hash === undefined ||
				image.id === undefined ||
				image.tags === undefined ||
				image.attributes === undefined ||
				image.active === undefined ||
				image.caption === undefined
			) {
				throw Error(`Image missing hash or id`);
			}
			const api_image = image as api.ApiImage;

			let obj = this.imagesByHash.get(image.hash) ?? null;

			if (obj === null) {
				obj = new ImageObject(
					image.id,
					image.hash,
					image.tags,
					new Map<string, string[]>(Object.entries(image.attributes)),
					image.active,
					image.caption
				);
				this.imagesById.set(image.id, obj);
				this.imagesByHash.set(image.hash, obj);
			}

			obj.merge(api_image);

			this.searchList.push(obj);
		}*/
	}

	addImageToCache(image: api.ApiImage) {
		let obj = this.imagesByHash.get(image.hash) ?? null;

		if (obj === null) {
			obj = new ImageObject(
				image.id,
				image.hash,
				image.tags,
				new Map<string, string[]>(Object.entries(image.attributes)),
				image.active,
				image.caption
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

	async fetchImageByHash(image_hash: string) {
		let image: api.ApiImage | null;

		try {
			image = await api.getImageByHash(image_hash);
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

	async fetchImageById(image_id: number) {
		let image: api.ApiImage | null;

		try {
			image = await api.getImageById(image_id);
		} catch (error) {
			errorMessageState.setErrorMessage(`Error fetching image by id: ${error as string}`);
			return null;
		}

		runInAction(() => {
			if (image !== null) {
				this.addImageToCache(image);
			}
		});
	}

	/*getSearchIndexByHash(image_hash: string): number | null {
		const index = this.searchList.findIndex((image) => image.hash === image_hash);

		if (index === -1) {
			return null;
		}

		return index;
	}*/

	getSearchIndexById(image_id: number): number | null {
		const index = this.searchList.indexOf(image_id);

		if (index === -1) {
			return null;
		}

		return index;
	}

	getImageByIndex(index: number): ImageObject | null {
		if (index < 0 || index >= this.searchList.length) {
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
		return this.getImageByIndex(Math.min(Math.max(0, index), this.searchList.length - 1));
	}

	getImageIdByIndexClamped(index: number): number | null {
		if (this.searchList.length === 0) {
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
