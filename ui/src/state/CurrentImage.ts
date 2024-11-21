import { makeAutoObservable, runInAction } from "mobx";
import { ImageObject, Tag, TagSuggestion, errorMessageState, fetchTagSuggestions } from "../state";
import { imageListState } from "./ImageList";
import { tagListState } from "./TagList";
import * as api from "../api";

export class CurrentImageState {
	private _imageId: number | null = null;
	private _displayedImageId: number | null = null;
	suggestedTags: TagSuggestion[] | null = null;
	suggestedTagsInFlight = false;
	serverDown: boolean = false;

	constructor() {
		makeAutoObservable(this);
	}

	get imageId(): number | null {
		return this._imageId;
	}

	get displayedImageId(): number | null {
		return this._displayedImageId;
	}

	set displayedImageId(image_id: number | null) {
		this._displayedImageId = image_id;
	}

	set imageId(image_id: number | null) {
		const imageChanged = this._imageId != image_id;

		if (image_id === null) {
			localStorage.setItem("currentImageId", "");
		} else {
			localStorage.setItem("currentImageId", image_id.toString());

			const currentImageIdForSearch = JSON.parse(localStorage.getItem("currentImageIdForSearch") ?? "{}") as Record<
				string,
				string
			>;

			currentImageIdForSearch[imageListState.currentSearch] = image_id.toString();
			localStorage.setItem("currentImageIdForSearch", JSON.stringify(currentImageIdForSearch));
		}
		this._imageId = image_id;

		if (imageChanged) {
			console.log(`Current image changed, clearing suggested tags`);
			this.suggestedTags = null;
			this.suggestedTagsInFlight = false;

			if (image_id !== null) {
				// Make sure we have the image in our cache and update it
				void imageListState.fetchImage(image_id);
			}
		}
	}

	async fetchTagSuggestions() {
		const currentImage = this.image;
		let result: [TagSuggestion[], number] | null = null;

		if (currentImage === null) {
			return;
		}

		// Send off a request for tag suggestions
		runInAction(() => {
			this.setSuggestedTagsInFlight(currentImage);
		});

		try {
			result = await fetchTagSuggestions(currentImage);
		} catch (error) {
			// Check if it's a 502 error
			if (error instanceof api.HttpError && error.statusCode === 502) {
				// If it is, don't show an error message
				runInAction(() => {
					this.serverDown = true;
				});
				return;
			}

			errorMessageState.setErrorMessage(`Error fetching tag suggestions: ${error as string}`);
			return;
		}

		runInAction(() => {
			if (result !== null) {
				console.log(`Got tag suggestions for ${result[1]}`);
				this.setSuggestedTags(result[0], currentImage);
				this.serverDown = false;
			}
		});
	}

	setSuggestedTagsInFlight(forImage: ImageObject) {
		if (this.imageId == forImage.id) {
			this.suggestedTagsInFlight = true;
		}
	}

	setSuggestedTags(tags: TagSuggestion[], forImage: ImageObject) {
		if (this.imageId == forImage.id) {
			this.suggestedTags = tags;
			this.suggestedTagsInFlight = false;
		}
	}

	get image(): ImageObject | null {
		if (this.imageId === null) {
			return null;
		}

		return imageListState.getImageById(this.imageId);
	}

	get displayedImage(): ImageObject | null {
		if (this.displayedImageId === null) {
			return null;
		}

		return imageListState.getImageById(this.displayedImageId);
	}

	get tagMap(): Map<string, Tag> | null {
		const currentImage = this.image;
		const tagIdToTag = tagListState.tagIdToTagMap;

		if (currentImage === null || tagIdToTag === null) {
			return null;
		}

		const tagMap = new Map<string, Tag>();

		for (const tagId of currentImage.flatTags) {
			const tag = tagIdToTag.get(tagId);

			if (tag !== null && tag !== undefined) {
				tagMap.set(tag.name, tag);
			}
		}

		return tagMap;
	}

	get searchIndex(): number | null {
		const currentImageId = this.imageId;

		if (currentImageId === null) {
			return null;
		}

		const index = imageListState.getSearchIndexById(currentImageId);

		return index;
	}

	nextImage() {
		// If we can't find the current image, start back at 0.
		const currentIndex = this.searchIndex ?? 0;
		const newId = imageListState.getImageIdByIndexClamped(currentIndex + 1);

		if (newId === null) {
			console.log(`nextImage: currentIndex=${currentIndex}; newId is null`);
			return;
		}

		console.log(`nextImage: currentIndex=${currentIndex}; newId=${newId}`);

		this.imageId = newId;
	}

	previousImage() {
		// If we can't find the current image, start back at 0.
		const currentIndex = this.searchIndex ?? 0;
		const newId = imageListState.getImageIdByIndexClamped(currentIndex - 1);

		if (newId === null) {
			console.log(`previousImage: currentIndex=${currentIndex}; newId is null`);
			return;
		}

		this.imageId = newId;
	}

	async nextUntaggedImage() {
		let inx = this.searchIndex ?? 0;

		while (true) {
			inx += 1;

			const image_id = imageListState.getImageIdByIndexClamped(inx);

			if (image_id === null) {
				break;
			}

			if (imageListState.getSearchIndexById(image_id) == inx) {
				// We've reached the end of the list
				break;
			}

			// Get the image's metadata
			await imageListState.fetchImage(image_id);

			const image = imageListState.getImageById(image_id);

			if (image === null) {
				break;
			}

			if (image.tags.size < 5) {
				runInAction(() => {
					this.imageId = image.id;
				});
				return;
			}
		}

		console.log(`nextUntaggedImage: no untagged images found`);
	}
}

export const currentImageState = new CurrentImageState();
