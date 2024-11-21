import { autorun, makeAutoObservable, runInAction } from "mobx";
import { tagListState } from "./TagList";
import { currentImageState } from "./CurrentImage";
import * as api from "../api";
import { Tag, errorMessageState } from "../state";

export interface TagAssociation {
	tag: Tag;
	probability: number;
}

class TagAssociationState {
	tags: TagAssociation[] = [];
	serverDown: boolean = false;

	constructor() {
		makeAutoObservable(this);
	}

	setServerDown(serverDown: boolean) {
		this.serverDown = serverDown;
	}
}

export const tagAssociationState = new TagAssociationState();

autorun(
	async () => {
		const tagNameToTag = tagListState.tagNameToTagMap;
		const tagIdToTag = tagListState.tagIdToTagMap;
		const activeTags = currentImageState.image?.flatTags;
		const currentImageHash = currentImageState.image?.hash;

		if (activeTags === undefined || tagIdToTag === null || tagNameToTag === null || currentImageHash === undefined) {
			return;
		}

		const tags = [];

		for (const tagId of activeTags) {
			const tag = tagIdToTag.get(tagId);

			if (tag !== undefined) {
				tags.push(tag.name);
			}
		}

		let associations;

		try {
			associations = await api.getTagImageAssociations(tags, currentImageHash);
		} catch (error) {
			console.log("Error fetching tag associations:", error);
			// Check if it's a 502 error
			if (error instanceof api.HttpError && error.statusCode === 502) {
				console.log("Eating error");
				// If it is, don't show an error message
				runInAction(() => {
					tagAssociationState.setServerDown(true);
				});
				return;
			}

			errorMessageState.setErrorMessage(`Error fetching tag associations: ${error as string}`);
			return;
		}

		const tagAssociations = new Array<TagAssociation>();

		for (const [tag, probability] of associations.entries()) {
			const tagObject = tagNameToTag.get(tag);

			if (tagObject === undefined) {
				continue;
			}

			tagAssociations.push({
				tag: tagObject,
				probability: probability,
			});
		}

		runInAction(() => {
			tagAssociationState.tags = tagAssociations;
			tagAssociationState.setServerDown(false);
		});
	},
	{ delay: 1000 },
);
