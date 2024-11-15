import { makeAutoObservable, runInAction } from "mobx";
import { Tag, errorMessageState } from "../state";
import * as api from "../api";
import Fuse from "fuse.js";

export enum TagListStateStatus {
	Idle,
	Fetching,
	Success,
}

class TagListState {
	tags: Tag[] | null = null;
	aliases: Map<string, string> | null = null;
	implications: Map<string, Set<string>> | null = null;
	blacklistAndDeprecations: Set<string> | null = null;
	status: TagListStateStatus = TagListStateStatus.Idle;

	constructor() {
		makeAutoObservable(this);
	}

	async fetchTagList() {
		let data: api.ApiTag[];
		let mappingData: api.ApiTagMappings;

		this.setStatus(TagListStateStatus.Fetching);

		try {
			data = await api.listTags();
		} catch (error) {
			errorMessageState.setErrorMessage(`Error fetching tag list: ${error as string}, will retry in 5 seconds`);

			// Retry after a delay
			new Promise((resolve) => setTimeout(resolve, 5000));

			return;
		}

		const dataTags = data.map((tag) => new Tag(tag.id, tag.name, tag.active));

		try {
			mappingData = await api.getTagMappings();
		} catch (error) {
			errorMessageState.setErrorMessage(`Error fetching tag mappings: ${error as string}, will retry in 5 seconds`);

			// Retry after a delay
			new Promise((resolve) => setTimeout(resolve, 5000));
			
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
			this.status = TagListStateStatus.Success;
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

		// Update
		await this.fetchTagList();
	}

	setStatus(status: TagListStateStatus) {
		this.status = status;
	}
}

export const tagListState = new TagListState();
