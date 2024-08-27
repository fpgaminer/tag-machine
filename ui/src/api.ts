export const API_URL = "/api";
const PREDICTION_API_URL = "/prediction";
const USER_ID = 1;

export interface ApiTag {
	id: number;
	name: string;
	active: boolean;
}

export interface ApiImage {
	id: number;
	hash: string;
	tags: number[];
	attributes: { [key: string]: string[] };
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

export type SearchOperator =
	| { kind: "not"; value: SearchOperator }
	| { kind: "and"; value: [SearchOperator, SearchOperator] }
	| { kind: "or"; value: [SearchOperator, SearchOperator] }
	| { kind: "tag"; value: number }
	| { kind: "attribute"; value: [string, string] }
	| { kind: "min_id"; value: number }
	| { kind: "max_id"; value: number };

export type SearchOrderBy = "id" | "hash";

export function searchOperatorToString(operator: SearchOperator): string {
	switch (operator.kind) {
		case "not":
			return `not ${searchOperatorToString(operator.value)}`;
		case "and":
			return `(${searchOperatorToString(operator.value[0])} and ${searchOperatorToString(operator.value[1])})`;
		case "or":
			return `(${searchOperatorToString(operator.value[0])} or ${searchOperatorToString(operator.value[1])})`;
		case "tag":
			return `tag:${operator.value}`;
		case "attribute":
			return `${operator.value[0]}=${operator.value[1]}`;
		case "min_id":
			return `min_id:${operator.value}`;
		case "max_id":
			return `max_id:${operator.value}`;
	}
}

export function searchOperatorToJson(operator: SearchOperator | null): object | null {
	if (operator === null) {
		return null;
	}

	switch (operator.kind) {
		case "tag":
			return {
				tag: operator.value,
			};
		case "attribute":
			return {
				attribute: [operator.value[0], operator.value[1]],
			};
		case "not":
			return {
				not: searchOperatorToJson(operator.value),
			};
		case "and":
			return {
				and: [searchOperatorToJson(operator.value[0]), searchOperatorToJson(operator.value[1])],
			};
		case "or":
			return {
				or: [searchOperatorToJson(operator.value[0]), searchOperatorToJson(operator.value[1])],
			};
		case "min_id":
			return {
				minid: operator.value,
			};
		case "max_id":
			return {
				maxid: operator.value,
			};
	}
}

export type SearchSelect = "id" | "hash" | "tags" | "attributes" | "active" | "caption" | "count" | "min_id" | "max_id";

export async function listTags(): Promise<ApiTag[]> {
	const response = await fetch(`${API_URL}/tags`);
	if (!response.ok) {
		throw new Error(`Failed to get tags: ${response.status}`);
	}

	return (await response.json()) as ApiTag[];
}

export async function getTagByName(name: string): Promise<ApiTag | null> {
	const response = await fetch(`${API_URL}/tag_by_name/${name}`);
	if (!response.ok) {
		throw new Error(`Failed to get tag by name: ${response.status}`);
	}

	return (await response.json()) as ApiTag;
}

export async function addTag(name: string): Promise<void> {
	const response = await fetch(`${API_URL}/add_tag`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to add tag: ${response.status}`);
	}

	return;
}

export async function removeTag(name: string): Promise<void> {
	const response = await fetch(`${API_URL}/remove_tag`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to remove tag: ${response.status}`);
	}

	return;
}

export async function searchImages(
	select: SearchSelect[],
	orderBy: SearchOrderBy | null,
	limit: number | null,
	operator: SearchOperator | null
): Promise<ApiSearchResults> {
	const operatorJson = searchOperatorToJson(operator);

	const response = await fetch(`${API_URL}/search_images`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			order_by: orderBy,
			limit,
			operator: operatorJson,
			select: select,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to search images: ${response.status}`);
	}

	return (await response.json()) as ApiSearchResults;
}

export async function getImageByHash(hash: string): Promise<ApiImage | null> {
	const response = await fetch(`${API_URL}/image_by_hash/${hash}`);

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to get image by hash: ${response.status}`);
	}

	return (await response.json()) as ApiImage;
}

export async function getImageById(id: number): Promise<ApiImage | null> {
	const response = await fetch(`${API_URL}/image_by_id/${id}`);

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to get image by id: ${response.status}`);
	}

	return (await response.json()) as ApiImage;
}

export async function addImage(hash: string): Promise<void> {
	const response = await fetch(`${API_URL}/add_image`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to add image: ${response.status}`);
	}

	return;
}

export async function removeImage(hash: string): Promise<void> {
	const response = await fetch(`${API_URL}/remove_image`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to remove image: ${response.status}`);
	}

	return;
}

export async function addImageAttribute(hash: string, key: string, value: string, singular: boolean): Promise<void> {
	const response = await fetch(`${API_URL}/add_image_attribute`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			key,
			value,
			user: USER_ID,
			singular,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to add image attribute: ${response.status}`);
	}

	return;
}

export async function removeImageAttribute(hash: string, key: string, value: string): Promise<void> {
	const response = await fetch(`${API_URL}/remove_image_attribute`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			key,
			user: USER_ID,
			value,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to remove image attribute: ${response.status}`);
	}

	return;
}

export async function captionImage(hash: string, caption: string): Promise<void> {
	const response = await fetch(`${API_URL}/caption_image`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			caption,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to caption image: ${response.status}`);
	}

	return;
}

export async function tagImage(hash: string, tag: string): Promise<void> {
	const response = await fetch(`${API_URL}/tag_image`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			tag,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to tag image: ${response.status}`);
	}

	return;
}

export async function untagImage(hash: string, tag: string): Promise<void> {
	const response = await fetch(`${API_URL}/untag_image`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash,
			tag,
			user: USER_ID,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to untag image: ${response.status}`);
	}

	return;
}

export async function getTagSuggestions(hash: string): Promise<Map<string, number>> {
	const response = await fetch(`${PREDICTION_API_URL}/predict`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash: hash,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to get tag suggestions: ${response.status}`);
	}

	const jsonObject = (await response.json()) as ApiTagSuggestions;
	return new Map(Object.entries(jsonObject));
}

export async function getTagAssociations(tags: string[]): Promise<Map<string, number>> {
	const response = await fetch(`${PREDICTION_API_URL}/tag_assoc`, {
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
	const response = await fetch(`${PREDICTION_API_URL}/tag_assoc`, {
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
		throw new Error(`Failed to get tag associations: ${response.status}`);
	}

	const jsonObject = (await response.json()) as ApiTagSuggestions;
	return new Map(Object.entries(jsonObject));
}

export async function getImageCaptionSuggestion(hash: string): Promise<string> {
	const response = await fetch(`${PREDICTION_API_URL}/caption`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			hash: hash,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to get caption suggestion: ${response.status}`);
	}

	const jsonObject = (await response.json()) as ApiCaptionSuggestion;
	return jsonObject.caption;
}

export async function getTagMappings(): Promise<ApiTagMappings> {
	const response = await fetch(`${API_URL}/tag_mappings`);
	if (!response.ok) {
		throw new Error(`Failed to get tag mappings: ${response.status}`);
	}

	return (await response.json()) as ApiTagMappings;
}

export async function uploadImage(file: File): Promise<void> {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("user", USER_ID.toString());

	console.log("Sending image upload request");
	const response = await fetch(`${API_URL}/upload_image`, {
		method: "POST",
		body: formData,
	});
	console.log("Got image upload response");

	if (!response.ok) {
		throw new Error(`Failed to upload image: ${response.status}`);
	}

	return;
}
