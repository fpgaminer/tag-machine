import { popupsState, PopupStates, Tag } from "./state";
import DTextDisplay, { DTextTag } from "./DTextDisplay";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import Popup from "./Popup";
import { makeAutoObservable } from "mobx";

const DANBOORU_API = "https://danbooru.donmai.us";

interface PostData {
	id: number;
	file_url: string;
	large_file_url: string;
	preview_file_url: string;
}

type WikiPages = Record<string, DTextTag[]>;

let wikiPagesPromise: Promise<WikiPages> | null = null;

async function loadWikiPages(): Promise<WikiPages> {
	if (wikiPagesPromise === null) {
		wikiPagesPromise = import("./parsed_tag_pages.json").then((module) => module.default as WikiPages);
	}

	return wikiPagesPromise;
}

export const WikiPopup = observer(function WikiPopupComponent() {
	const tag = wikiPopupState.tag;
	const [previewData, setPreviewData] = useState<PostData[] | null>(null);
	const [wikiPages, setWikiPages] = useState<WikiPages | null>(null);

	// Fetch preview posts for this tag
	useEffect(() => {
		async function fetchPreviewData(tag: Tag) {
			const response = await fetch(`${DANBOORU_API}/posts.json?tags=${tag.name}&limit=9`);
			const data = (await response.json()) as PostData[];

			// Filter out posts that don't have a preview
			data.filter((post) => post.preview_file_url !== null);

			// Limit to 6 posts
			data.splice(6);

			setPreviewData(data);
		}

		if (tag !== null) {
			void fetchPreviewData(tag);
		}
	}, [tag]);

	useEffect(() => {
		if (tag === null || wikiPages !== null) {
			return;
		}

		void loadWikiPages()
			.then(setWikiPages)
			.catch((error: unknown) => {
				console.error("Failed to load wiki pages", error);
			});
	}, [tag, wikiPages]);

	if (tag === null) {
		return null;
	}

	const tagDText = wikiPages?.[tag.name];

	if (wikiPages !== null && tagDText === undefined) {
		return null;
	}

	return (
		<Popup onClose={() => popupsState.removePopup(PopupStates.Wiki)} title={tag.name} className="wiki-popup">
			<div className="wiki-popup-body-content">
				{tagDText !== undefined ? <DTextDisplay dtext={tagDText} /> : <p>Loading wiki...</p>}
				<PostPreviews posts={previewData ?? []} />
			</div>
		</Popup>
	);
});

function PostPreviews(props: { posts: PostData[] }) {
	const { posts } = props;

	const postItems = posts.map((post) => {
		return (
			<a href={`${DANBOORU_API}/posts/${post.id}`} target="_blank" rel="noreferrer" key={post.id}>
				<img src={post.preview_file_url} alt="" />
			</a>
		);
	});

	return <div className="wiki-popup-post-previews">{postItems}</div>;
}

export const wikiPopupState = makeAutoObservable({
	tag: null as Tag | null,
	setTag(tag: Tag) {
		this.tag = tag;
	},
});
