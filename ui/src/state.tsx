import { autorun, makeAutoObservable, reaction, runInAction } from "mobx";
import * as api from "./api";
import { imageListState } from "./state/ImageList";
import { tagListState } from "./state/TagList";
import { currentImageState } from "./state/CurrentImage";
import { scryptAsync } from "@noble/hashes/scrypt";
import { authState, checkIfLoggedIn } from "./state/Auth";

export const IMAGE_LIST_FETCH_SIZE = 256;

export class ImageObject {
	readonly id: number;
	readonly hash: string;
	tags: Set<number>;
	attributes: Map<string, string[]>;
	active: boolean;
	caption: string | null;

	constructor(
		id: number,
		hash: string,
		tags: number[],
		attributes: Map<string, string[]>,
		active: boolean,
		caption: string | null
	) {
		this.id = id;
		this.hash = hash;
		this.tags = new Set(tags);
		this.attributes = attributes;
		this.active = active;
		this.caption = caption;
		makeAutoObservable(this);
	}

	addTag(tag: Tag) {
		if (this.tags === null) {
			throw Error("Tags not loaded yet");
		}

		this.tags.add(tag.id);
	}

	removeTag(tag: Tag) {
		if (this.tags === null) {
			throw Error("Tags not loaded yet");
		}

		if (!this.tags.delete(tag.id)) {
			throw Error("Tag not found");
		}
	}

	/**
	 * Merges the properties of an ApiImage onto this one in-place.
	 * @param other - The ApiImage to merge onto this one.
	 */
	merge(other: api.ApiImage): void {
		if (this.id !== other.id) {
			throw Error("Cannot merge ImageObject with ApiImage: different IDs");
		}

		// hash never changes
		this.tags.clear();
		for (const tag of other.tags) {
			this.tags.add(tag);
		}
		this.attributes.clear();
		for (const [key, value] of Object.entries(other.attributes)) {
			this.attributes.set(key, value);
		}
		this.active = other.active;
		this.caption = other.caption;
	}

	get trainingPrompt(): string | null {
		const trainingPrompts = this.attributes.get("training_prompt") ?? null;
		const trainingPrompt = trainingPrompts ? trainingPrompts[0] : null;

		return trainingPrompt;
	}
}

export class Tag {
	id: number;
	name: string;
	active: boolean;

	constructor(id: number, name: string, active: boolean) {
		this.id = id;
		this.name = name;
		this.active = active;
		makeAutoObservable(this);
	}

	get favorite(): boolean {
		return favoriteTagsState.isFavoriteTag(this);
	}
}

export class TagSuggestion {
	name: string;
	score: number;

	constructor(name: string, score: number) {
		this.name = name;
		this.score = score;
	}
}

class ErrorMessageState {
	errorMessage: string | null = null;

	constructor() {
		makeAutoObservable(this);
	}

	setErrorMessage(errorMessage: string | null) {
		if (errorMessage !== null) {
			console.error(errorMessage);
		}

		this.errorMessage = errorMessage;
	}
}

export const errorMessageState = new ErrorMessageState();

/* WindowStates */
export enum WindowStates {
	Login,
	Tagging,
	Captioning,
}

class WindowState {
	state: WindowStates = WindowStates.Login;

	constructor() {
		makeAutoObservable(this);
	}

	setWindowState(state: WindowStates) {
		this.state = state;
	}
}

export const windowState = new WindowState();

/* WikiPopupState */
class WikiPopupState {
	visible = false;
	tag: Tag | null = null;

	constructor() {
		makeAutoObservable(this);
	}

	setWikiPopupVisible(visible: boolean) {
		this.visible = visible;
	}

	setTag(tag: Tag | null) {
		this.tag = tag;
	}
}

export const wikiPopupState = new WikiPopupState();

/* Image Resolution State */
class ImageResolutionState {
	resolution: number | null = null;

	constructor() {
		makeAutoObservable(this);
	}

	setResolution(resolution: number | null) {
		this.resolution = resolution;
	}
}

export const imageResolutionState = new ImageResolutionState();

/* Image Info Popup State */
class ImageInfoPopupState {
	visible = false;
	image: ImageObject | null = null;

	constructor() {
		makeAutoObservable(this);
	}

	setImage(image: ImageObject | null) {
		this.image = image;
	}

	setImageInfoPopupVisible(visible: boolean) {
		this.visible = visible;
	}
}

export const imageInfoPopupState = new ImageInfoPopupState();

class UploadPopupState {
	visible = false;

	constructor() {
		makeAutoObservable(this);
	}

	setUploadPopupVisible(visible: boolean) {
		this.visible = visible;
	}
}

export const uploadPopupState = new UploadPopupState();

class FavoriteTagsState {
	_favoriteTags: Set<string> = new Set(JSON.parse(localStorage.getItem("favoriteTags") || "[]") as string[]);

	constructor() {
		makeAutoObservable(this);
	}

	get favoriteTags(): Set<string> {
		return this._favoriteTags;
	}

	set favoriteTags(tags: Set<string>) {
		this._favoriteTags = tags;
		// Persist the favorite tags
		localStorage.setItem("favoriteTags", JSON.stringify(Array.from(this._favoriteTags)));
	}

	addFavoriteTag(tag: Tag) {
		this.favoriteTags.add(tag.name);
		localStorage.setItem("favoriteTags", JSON.stringify(Array.from(this.favoriteTags)));
	}

	removeFavoriteTag(tag: Tag) {
		this.favoriteTags.delete(tag.name);
		localStorage.setItem("favoriteTags", JSON.stringify(Array.from(this.favoriteTags)));
	}

	isFavoriteTag(tag: Tag) {
		return this.favoriteTags.has(tag.name);
	}
}

export const favoriteTagsState = new FavoriteTagsState();

export const imageHashToUrl = (hash: string) => {
	return `${api.API_URL}/images/${hash}`;
};

export async function captionImage(image: ImageObject, caption: string) {
	if (image.caption === caption) {
		// No change
		return;
	}

	try {
		await api.captionImage(image.hash, caption);
	} catch (error) {
		errorMessageState.setErrorMessage(`Error setting caption: ${error as string}`);
		return;
	}

	runInAction(() => {
		image.caption = caption;
	});
}

export async function setImageTrainingPrompt(image: ImageObject, trainingPrompt: string) {
	if (image.trainingPrompt === trainingPrompt) {
		// No change
		return;
	}

	try {
		await api.addImageAttribute(image.hash, "training_prompt", trainingPrompt, true);
	} catch (error) {
		errorMessageState.setErrorMessage(`Error setting training prompt: ${error as string}`);
		return;
	}

	runInAction(() => {
		image.attributes.set("training_prompt", [trainingPrompt]);
	});
}

export async function suggestCaption(image: ImageObject): Promise<string | null> {
	try {
		return await api.getImageCaptionSuggestion(image.hash);
	} catch (error) {
		errorMessageState.setErrorMessage(`Error suggesting caption: ${error as string}`);
		return null;
	}
}

export async function toggleImageTag(image: ImageObject, tag: Tag) {
	const imageTags = image.tags;
	const tagImplications = tagListState.implications;
	const addTag = !imageTags.has(tag.id);
	const tagIdToTag = tagListState.tagIdToTagMap;
	const tagsToAddOrRemove: Tag[] = [tag];

	if (tagImplications === null || tagIdToTag === null) {
		throw Error("Tag list not loaded yet");
	}

	if (!tag.active || !image.active) {
		throw Error("Cannot toggle inactive image or tag");
	}

	const impliedTags = Array.from(tagImplications.get(tag.name) ?? [])
		.map((impliedTag) => tagListState.getTagByName(impliedTag))
		.filter((impliedTag) => impliedTag !== null) as Tag[];

	const imageTagObjects = Array.from(imageTags).map((tagId) => {
		const tagObject = tagIdToTag.get(tagId);

		if (tagObject === undefined) {
			throw Error("Tag list is inconsistent");
		}

		return tagObject;
	});

	if (addTag) {
		// Also add implied tags
		for (const impliedTag of impliedTags) {
			if (!imageTags.has(impliedTag.id)) {
				tagsToAddOrRemove.push(impliedTag);
			}
		}
	}
	/* else {
		// Also remove implied tags
		const tagsToRemove = new Set<Tag>(impliedTags.filter((impliedTag) => imageTags.has(impliedTag.id)));

		// But only remove implied tags that won't be supported by other tags on the image
		for (const imageTag of imageTagObjects) {
			if (imageTag === tag) {
				continue;
			}

			for (const impliedTag of tagImplications.get(imageTag.name) ?? []) {
				const impliedTagObject = tagListState.getTagByName(impliedTag);

				if (impliedTagObject !== null && imageTags.has(impliedTagObject.id)) {
					// This tag is implied by another tag on the image, so don't remove it
					tagsToRemove.delete(impliedTagObject);
				}
			}
		}

		tagsToAddOrRemove.push(...Array.from(tagsToRemove));
	}*/

	const tagsToAddOrRemoveStr = tagsToAddOrRemove.map((tag) => tag.name).join(", ");

	console.log(
		`Toggling tag ${tag.name} on image ${image.hash}: ${addTag ? "add" : "remove"}; tags to add/remove:`,
		tagsToAddOrRemoveStr
	);

	if (addTag) {
		for (const tagToAdd of tagsToAddOrRemove) {
			// Add the tags by first informing the API
			try {
				await api.tagImage(image.hash, tagToAdd.name);
			} catch (error) {
				errorMessageState.setErrorMessage(`Error adding tag to image: ${error as string}`);
				return;
			}

			// If the API call succeeded, add the tag to the image on our side
			image.addTag(tagToAdd);
		}
	} else {
		for (const tagToRemove of tagsToAddOrRemove) {
			// Remove the tags by first informing the API
			try {
				await api.untagImage(image.hash, tagToRemove.name);
			} catch (error) {
				errorMessageState.setErrorMessage(`Error removing tag from image: ${error as string}`);
				return;
			}

			// If the API call succeeded, remove the tag from the image on our side
			image.removeTag(tagToRemove);
		}
	}
}

// Pre-fetch images based on the current image
autorun(() => {
	const searchList = imageListState.searchList;
	const currentImageIndex = currentImageState.searchIndex;
	const user_token = authState.user_token;

	if (searchList === null || currentImageIndex === null) {
		return;
	}

	for (let i = currentImageIndex - 1; i <= currentImageIndex + 1; i++) {
		const imageId = imageListState.getImageIdByIndexClamped(i);

		if (imageId === null) {
			continue;
		}

		void imageListState.fetchImageById(imageId);

		const image = imageListState.getImageByIndexClamped(i);

		if (image !== null && user_token !== null) {
			fetch(imageHashToUrl(image.hash), {
				headers: {
				  'Authorization': `Bearer ${user_token}`
				}
			})
			.then(response => response.blob());
			//const elem = new Image();
			//elem.src = imageHashToUrl(image.hash);
		}
	}
});

// Fetch tag suggestions
autorun(() => {
	const currentImage = currentImageState.image;
	const currentTagSuggestions = currentImageState.suggestedTags;

	if (currentImage === null || currentTagSuggestions !== null) {
		// No image or already have suggestions
		return;
	}

	if (currentImageState.suggestedTagsInFlight) {
		// Already have a request in flight
		return;
	}

	void currentImageState.fetchTagSuggestions();
});

export async function fetchTagSuggestions(image: ImageObject): Promise<[TagSuggestion[], number] | null> {
	const aliases = tagListState.aliases;
	const blacklistAndDeprecations = tagListState.blacklistAndDeprecations;

	if (aliases === null || blacklistAndDeprecations === null) {
		console.warn("Model tags or tag mappings not loaded yet, can't predict");
		return null;
	}

	const data = await api.getTagSuggestions(image.hash);

	const tagSuggestions = new Map<string, TagSuggestion>();

	for (const [tag, score] of data.entries()) {
		const aliasedTag: string = aliases.get(tag) ?? tag;

		if (blacklistAndDeprecations.has(aliasedTag)) {
			continue;
		}

		const existingTagSuggestion = tagSuggestions.get(aliasedTag);

		if (existingTagSuggestion !== undefined) {
			existingTagSuggestion.score = Math.max(existingTagSuggestion.score, score);
		} else {
			tagSuggestions.set(aliasedTag, new TagSuggestion(aliasedTag, score));
		}
	}

	return [Array.from(tagSuggestions.values()), image.id];
}

// Initialize the state
export async function initState() {
	const savedSearch = localStorage.getItem("currentSearch");

	// Check if we're logged in
	await checkIfLoggedIn();

	// Restore search
	console.log(`initState: restoring search:`, savedSearch);
	if (savedSearch !== null) {
		try {
			imageListState.setCurrentSearch(savedSearch);
		} catch (error) {
			errorMessageState.setErrorMessage(`Error restoring search: ${error as string}`);
			imageListState.setCurrentSearch("");
		}
	}
}

// Login
export async function login(username: string, password: string | null, key: string | null) {
	let login_key = key;

	if (login_key === null && password !== null) {
		// Scrypt the password
		const encodedPassword = await scryptAsync(password, username, { N: 2 ** 16, r: 8, p: 1, dkLen: 32 });

		// Hex encode the password
		login_key = Array.from(encodedPassword).map(byte => byte.toString(16).padStart(2, '0')).join('');
	}
	else if (login_key === null) {
		throw Error("No password or key provided");
	}

	const user_token = await api.login(username, login_key);

	authState.setToken(user_token);
}

// Automatically switch to login screen if not logged in, or to tagging screen if logged in
autorun(() => {
	if (authState.loggedIn === true && windowState.state === WindowStates.Login) {
		windowState.setWindowState(WindowStates.Tagging);
	}
	else if (authState.loggedIn === false && windowState.state !== WindowStates.Login) {
		windowState.setWindowState(WindowStates.Login);
	}
});

// Fetch metadata when logging in
autorun(() => {
	if (authState.loggedIn === true && tagListState.fetched === false) {
		tagListState.fetchTagList();
	}

	if (authState.loggedIn === true && imageListState.initialSearchPerformed === false) {
		imageListState.performSearch().then(() => {
			imageListState.setInitialSearchPerformed();
		});
	}
});