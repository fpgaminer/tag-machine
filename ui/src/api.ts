import { authState } from "./state/Auth";

export const API_URL = "/api";
const PREDICTION_API_URL = "/prediction";

export interface ApiTag {
	id: number;
	name: string;
	active: boolean;
}

export interface ApiImage {
	id: number;
	hash: string;
	tags: { [key: number]: number };
	attributes: { [key: string]: { [key: string]: number } };
	active: boolean;
	caption: string;
}

interface ApiTagSuggestions {
	[key: string]: number;
}

interface ApiCaptionSuggestion {
	caption: string;
}

export interface ApiSearchImageResult {
	id?: number;
	hash?: string;
	tags?: number[];
	attributes?: { [key: string]: string[] };
	active?: boolean;
	caption?: string;
	count?: number;
	min_id?: number;
	max_id?: number;
}

export interface ApiSearchResults {
	images?: ApiSearchImageResult[];
	id?: number[];
}

export interface ApiTagMappings {
	aliases: { [key: string]: string };
	implications: { [key: string]: string[] };
	blacklist: string[];
	deprecations: string[];
}

export interface ApiUserInfo {
	id: number;
	username: string;
	scopes: string;
}

export interface ApiLoginResponse {
	token: string;
}

export type SearchSelect = "id" | "hash" | "tags" | "attributes" | "active" | "caption" | "count" | "min_id" | "max_id";

export async function authenticatedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
	const user_token = authState.user_token;

	if (user_token === null) {
		throw new Error("User token is null");
	}

	if (init === undefined) {
		init = {};
	}

	if (init.headers === undefined) {
		init.headers = new Headers();
	}
	else {
		init.headers = new Headers(init.headers);
	}

	init.headers.set("Authorization", `Bearer ${user_token}`);

	return fetch(input, init);
}

export async function listTags(): Promise<ApiTag[]> {
	const response = await authenticatedFetch(`${API_URL}/tags`);
	if (!response.ok) {
		throw new Error(`Failed to get tags: ${response.status}`);
	}

	return (await response.json()) as ApiTag[];
}

export async function addTag(name: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/tags/${name}`, {
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`Failed to add tag: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function removeTag(name: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/tags/${name}`, {
		method: "DELETE",
	});

	if (!response.ok) {
		throw new Error(`Failed to remove tag: ${response.status}: ${await response.text()}`);
	}

	return;
}

/*export async function searchImages(
	select: SearchSelect[],
	orderBy: SearchOrderBy | null,
	limit: number | null,
	operator: SearchOperator | null
): Promise<ApiSearchResults> {*/
export async function searchImages(
	select: SearchSelect[],
	limit: number | null,
	query: string,
): Promise<ApiSearchResults> {
	const params = new URLSearchParams({
		query: query,
	}).toString();
	const response = await authenticatedFetch(`${API_URL}/search/images?${params}`, {
		method: "GET",
	});

	if (!response.ok) {
		throw new Error(`Failed to search images: ${response.status}`);
	}

	return {
		id: await response.json(),
	};
}

export async function getImageMetadata(identifier: number | string): Promise<ApiImage | null> {
	const response = await authenticatedFetch(`${API_URL}/images/${identifier}/metadata`);

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to get image by hash: ${response.status}: ${await response.text()}`);
	}

	return (await response.json()) as ApiImage;
}

export async function addImage(hash: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${hash}`, {
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`Failed to add image: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function removeImage(identifier: number | string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${identifier}`, {
		method: "DELETE",
	});

	if (!response.ok) {
		throw new Error(`Failed to remove image: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function addImageAttribute(image: number | string, key: string, value: string, singular: boolean): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${image}/attributes/${encodeURIComponent(key)}/${encodeURIComponent(value)}/${singular}`, {
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`Failed to add image attribute: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function removeImageAttribute(image: number | string, key: string, value: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${image}/attributes/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
		method: "DELETE",
	});

	if (!response.ok) {
		throw new Error(`Failed to remove image attribute: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function tagImage(image: number | string, tag: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${image}/tags/${tag}`, {
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(`Failed to tag image: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function untagImage(image: number | string, tag: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/images/${image}/tags/${tag}`, {
		method: "DELETE",
	});

	if (!response.ok) {
		throw new Error(`Failed to untag image: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function getTagSuggestions(hash: string): Promise<Map<string, number>> {
	const response = await authenticatedFetch(`${PREDICTION_API_URL}/predict`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash: hash,
		}),
	});

	if (!response.ok) {
		throw response;
	}

	const jsonObject = (await response.json()) as ApiTagSuggestions;
	return new Map(Object.entries(jsonObject));
}

export async function getTagAssociations(tags: string[]): Promise<Map<string, number>> {
	const response = await authenticatedFetch(`${PREDICTION_API_URL}/tag_assoc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			tags: tags,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to get tag associations: ${response.status}`);
	}

	const jsonObject = (await response.json()) as ApiTagSuggestions;
	return new Map(Object.entries(jsonObject));
}

export async function getTagImageAssociations(tags: string[], hash: string): Promise<Map<string, number>> {
	const response = await authenticatedFetch(`${PREDICTION_API_URL}/tag_assoc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			tags: tags,
			hash: hash,
		}),
	});

	if (!response.ok) {
		throw response;
	}

	const jsonObject = (await response.json()) as ApiTagSuggestions;
	return new Map(Object.entries(jsonObject));
}

export async function getImageCaptionSuggestion(hash: string, prompt: string): Promise<string> {
	const response = await authenticatedFetch(`${PREDICTION_API_URL}/caption`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash: hash,
			prompt: prompt,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to get caption suggestion: ${response.status}`);
	}

	const jsonObject = (await response.json()) as ApiCaptionSuggestion;
	return jsonObject.caption;
}

export async function getTagMappings(): Promise<ApiTagMappings> {
	const response = await authenticatedFetch(`${API_URL}/tag_mappings`);

	if (!response.ok) {
		throw new Error(`Failed to get tag mappings: ${response.status}`);
	}

	return (await response.json()) as ApiTagMappings;
}

export async function uploadImage(file: File): Promise<void> {
	const formData = new FormData();
	formData.append("file", file);

	const response = await authenticatedFetch(`${API_URL}/upload_image`, {
		method: "POST",
		body: formData,
	});

	if (!response.ok) {
		throw new Error(`Failed to upload image: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function login(username: string, login_key: string): Promise<string> {
	const response = await fetch(`${API_URL}/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			username,
			login_key,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to login: ${response.status}`);
	}

	const json = (await response.json()) as ApiLoginResponse;
	return json.token;
}

export async function user_info(): Promise<ApiUserInfo | null> {
	const response = await authenticatedFetch(`${API_URL}/users/me`);

	if (response.status === 401) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to get user info: ${response.status}: ${await response.text()}`);
	}

	return (await response.json()) as ApiUserInfo;
}