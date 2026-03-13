import { makeAutoObservable, runInAction } from "mobx";
import { Tag, errorMessageState } from "../state";
import * as api from "../api";
import Fuse from "fuse.js";

export enum TagListStateStatus {
	Idle,
	Fetching,
	Success,
	Error,
}

class TagListState {
	tags: Tag[] | null = null;
	aliases: Map<string, string> | null = null;
	implications: Map<string, Set<string>> | null = null;
	blacklistAndDeprecations: Set<string> | null = null;
	status: TagListStateStatus = TagListStateStatus.Idle;

	private fetchRequestId = 0;
	private fetchAbortController: AbortController | null = null;

	constructor() {
		makeAutoObservable(this, {}, { autoBind: true });
	}

	async fetchTagList() {
		const requestId = ++this.fetchRequestId;

		// Abort any previous in-flight fetch
		this.fetchAbortController?.abort();
		const abortController = new AbortController();
		this.fetchAbortController = abortController;

		this.setStatus(TagListStateStatus.Fetching);

		try {
			const [data, mappingData] = await Promise.all([
				api.listTags({ signal: abortController.signal }),
				api.getTagMappings({ signal: abortController.signal }),
			]);

			// Ignore stale responses
			if (requestId !== this.fetchRequestId) {
				return;
			}

			runInAction(() => {
				this.applyFetchedData(data, mappingData);
			});
		} catch (error) {
			// Ignore aborted requests
			if (abortController.signal.aborted) {
				return;
			}

			// Ignore stale failures
			if (requestId !== this.fetchRequestId) {
				return;
			}

			runInAction(() => {
				this.status = TagListStateStatus.Error;
				errorMessageState.setErrorMessage(`Error fetching tag list: ${String(error)}, will retry in 5 seconds`);
			});

			// Retry after a delay
			await sleep(5000);

			// Only retry if no newer fetch started in the meantime
			if (requestId === this.fetchRequestId) {
				void this.fetchTagList();
			}
		}
	}

	get tagNameToTagMap(): Map<string, Tag> {
		const tags = this.tags ?? [];
		return new Map(tags.map((tag) => [tag.name, tag]));
	}

	get tagIdToTagMap(): Map<number, Tag> {
		const tags = this.tags ?? [];
		return new Map(tags.map((tag) => [tag.id, tag]));
	}

	get fuse(): Fuse<Tag> | null {
		if (this.tags === null) {
			return null;
		}

		return new Fuse(this.tags, { keys: ["name"] });
	}

	getTagByName(name: string): Tag | null {
		return this.tagNameToTagMap.get(name) ?? null;
	}

	async addTag(name: string) {
		if (this.tags === null) {
			throw Error("Tags not loaded yet");
		}

		// Check if the tag already exists
		const existingTag = this.getTagByName(name);

		if (existingTag?.active) {
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

		// Refetch the tag list to get the new tag and ensure consistency
		void this.fetchTagList();
	}

	setStatus(status: TagListStateStatus) {
		this.status = status;
	}

	private applyFetchedData(data: api.ApiTag[], mappingData: api.ApiTagMappings) {
		const dataTags = data.map((tag) => new Tag(tag.id, tag.name, tag.active));
		const aliases = new Map<string, string>(Object.entries(mappingData.aliases));
		const implications = new Map<string, Set<string>>(
			Object.entries(mappingData.implications).map(([key, value]) => [key, new Set(value)]),
		);
		const blacklist = new Set(mappingData.blacklist);
		const deprecations = new Set(mappingData.deprecations);
		const blacklistAndDeprecations = new Set([...blacklist, ...deprecations]);

		this.tags = dataTags;
		this.aliases = aliases;
		this.implications = implications;
		this.blacklistAndDeprecations = blacklistAndDeprecations;
		this.status = TagListStateStatus.Success;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const tagListState = new TagListState();
