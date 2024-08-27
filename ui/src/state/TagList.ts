import { makeAutoObservable, runInAction } from "mobx";
import { Tag, errorMessageState } from "../state";
import * as api from "../api";
import Fuse from "fuse.js";

class TagListState {
	tags: Tag[] | null = null;
	aliases: Map<string, string> | null = null;
	implications: Map<string, Set<string>> | null = null;
	blacklistAndDeprecations: Set<string> | null = null;

	constructor() {
		makeAutoObservable(this);
	}

	async fetchTagList() {
		let data: api.ApiTag[];
		let mappingData: api.ApiTagMappings;

		try {
			data = await api.listTags();
		} catch (error) {
			errorMessageState.setErrorMessage(`Error fetching tag list: ${error as string}`);
			return;
		}

		const dataTags = data.map((tag) => new Tag(tag.id, tag.name, tag.active));

		try {
			mappingData = await api.getTagMappings();
		} catch (error) {
			errorMessageState.setErrorMessage(`Error fetching tag mappings: ${error as string}`);
			return;
		}

		const aliases = new Map<string, string>(Object.entries(mappingData.aliases));
		const implications = new Map<string, Set<string>>(
			Object.entries(mappingData.implications).map(([key, value]) => [key, new Set<string>(value)])
		);
		const blacklist = new Set<string>(mappingData.blacklist);
		const deprecations = new Set<string>(mappingData.deprecations);
		const blacklistAndDeprecations = new Set<string>([...blacklist, ...deprecations]);

		runInAction(() => {
			this.tags = dataTags;
			this.aliases = aliases;
			this.implications = implications;
			this.blacklistAndDeprecations = blacklistAndDeprecations;
		});
	}

	get tagNameToTagMap(): Map<string, Tag> {
		if (this.tags === null) {
			return new Map<string, Tag>();
		}

		const tagMap = new Map<string, Tag>();

		for (const tag of this.tags) {
			tagMap.set(tag.name, tag);
		}

		return tagMap;
	}

	get tagIdToTagMap(): Map<number, Tag> {
		if (this.tags === null) {
			return new Map<number, Tag>();
		}

		const tagMap = new Map<number, Tag>();

		for (const tag of this.tags) {
			tagMap.set(tag.id, tag);
		}

		return tagMap;
	}

	get fuse(): Fuse<Tag> | null {
		if (this.tags === null) {
			return null;
		}

		return new Fuse(this.tags, { keys: ["name"] });
	}

	getTagByName(name: string): Tag | null {
		const tagMap = this.tagNameToTagMap;

		if (tagMap === null) {
			return null;
		}

		return tagMap.get(name) ?? null;
	}

	async addTag(name: string) {
		if (this.tags === null) {
			throw Error("Tags not loaded yet");
		}

		// Check if the tag already exists
		const existingTag = this.getTagByName(name);

		if (existingTag !== null && existingTag.active) {
			errorMessageState.setErrorMessage(`Tag ${name} already exists`);
			return;
		}

		// Add the tag using the API first
		try {
			await api.addTag(name);
		} catch (error) {
			errorMessageState.setErrorMessage(`Error adding tag: ${error as string}`);
			return;
		}

		// Fetch the tag
		let tag: api.ApiTag;

		try {
			const result = await api.getTagByName(name);

			if (result === null) {
				throw Error(`Tag ${name} not found after adding. WARNING: LOCAL STATE IS OUT OF DATE NOW`);
			}

			tag = result;
		} catch (error) {
			errorMessageState.setErrorMessage(
				`Error fetching tag (WARNING: LOCAL STATE IS OUT OF DATE NOW): ${error as string}`
			);
			return;
		}

		// Update our local state
		if (existingTag !== null) {
			runInAction(() => {
				existingTag.active = tag.active;
			});
		} else {
			runInAction(() => {
				if (this.tags === null) {
					throw Error("Tags not loaded yet");
				}

				this.tags.push(new Tag(tag.id, tag.name, tag.active));
			});
		}
	}
}

export const tagListState = new TagListState();
