import { ByteBuffer } from "flatbuffers";
import { authState } from "./state/Auth";
import { SearchResultResponse } from "./tag-storm-db-types/search-result-response";
import { ResponseType } from "./tag-storm-db-types/response-type";
import { IDResponse } from "./tag-storm-db-types/idresponse";
import { HashResponse } from "./tag-storm-db-types/hash-response";
import { ImageResponse } from "./tag-storm-db-types/image-response";

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

export type SearchSelect = "id" | "hash" | "tags" | "attributes";

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

export async function searchImages(
	select: SearchSelect[],
	limit: number | null,
	query: string,
): Promise<Uint32Array | HashResponse | ImageResponse> {
	// Combine select into a comma-separated string
	const selectString = select.join(",");

	const params = new URLSearchParams({
		query: query,
		select: selectString,
	}).toString();
	const response = await authenticatedFetch(`${API_URL}/search/images?${params}`, {
		method: "GET",
	});

	if (!response.ok) {
		throw new Error(`Failed to search images: ${response.status}: ${await response.text()}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const byteBuffer = new ByteBuffer(new Uint8Array(arrayBuffer));
	const searchResults = SearchResultResponse.getRootAsSearchResultResponse(byteBuffer);
	const responseType = searchResults.dataType();

	switch (responseType) {
		case ResponseType.IDResponse: {
			const idResponse = searchResults.data(new IDResponse()) as IDResponse;
			return idResponse.idsArray()!;
		}
		case ResponseType.HashResponse: {
			const hashResponse = searchResults.data(new HashResponse()) as HashResponse;
			return hashResponse;
		}
		case ResponseType.ImageResponse: {
			const imageResponse = searchResults.data(new ImageResponse()) as ImageResponse;
			return imageResponse;
		}
	}

	throw new Error(`Unknown response type: ${responseType}`);
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
		throw new Error(`Failed to login: ${response.status}: ${await response.text()}`);
	}

	const json = (await response.json()) as ApiLoginResponse;
	return json.token;
}

export async function userInfo(userId: number | string): Promise<ApiUserInfo | null> {
	const response = await authenticatedFetch(`${API_URL}/users/${userId}`);

	if (response.status === 401) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to get user info: ${response.status}: ${await response.text()}`);
	}

	return (await response.json()) as ApiUserInfo;
}

export async function createUser(username: string, login_key: string, cf_turnstile_token: string, birthdate: number, invite_code: string): Promise<void> {
	const response = await fetch(`${API_URL}/users`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			username,
			login_key,
			cf_turnstile_token,
			birthdate,
			invite_code,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to create user: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function invalidateUserToken(token: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/users/me/tokens/invalidate`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			token,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to invalidate user token: ${response.status}: ${await response.text()}`);
	}

	// If the token is the current user's token, clear it
	if (token === authState.user_token) {
		authState.clearToken();
	}

	return;
}

export async function changeUserLoginKey(new_login_key: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/users/me/login_key`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			new_login_key,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to change user login key: ${response.status}: ${await response.text()}`);
	}

	return;
}

export async function listUserTokens(userId: number | string): Promise<string[]> {
	const response = await authenticatedFetch(`${API_URL}/users/${userId}/tokens`);

	if (!response.ok) {
		throw new Error(`Failed to list user tokens: ${response.status}: ${await response.text()}`);
	}

	return (await response.json()) as string[];
}

export async function getCfTurnstileKey(): Promise<string> {
	const response = await fetch(`${API_URL}/cf_turnstile_key`);

	if (!response.ok) {
		throw new Error(`Failed to get Cloudflare Turnstile key: ${response.status}: ${await response.text()}`);
	}

	return (await response.text());
}

export async function listUsers(): Promise<ApiUserInfo[]> {
	const response = await authenticatedFetch(`${API_URL}/users`);

	if (!response.ok) {
		throw new Error(`Failed to list users: ${response.status}: ${await response.text()}`);
	}

	return (await response.json()) as ApiUserInfo[];
}

export async function changeUserScopes(userId: number, scopes: string): Promise<void> {
	const response = await authenticatedFetch(`${API_URL}/users/${userId}/scopes`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			new_scopes: scopes,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to change user scopes: ${response.status}: ${await response.text()}`);
	}

	return;
}