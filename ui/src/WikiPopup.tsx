import { popupsState, PopupStates, Tag } from "./state";
import wikiPages from "./parsed_tag_pages.json";
import DTextDisplay, { DTextTag } from "./DTextDisplay";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { makeAutoObservable } from "mobx";
import Popup from "./Popup";

const DANBOORU_API = "https://danbooru.donmai.us";

interface PostData {
	id: number;
	file_url: string;
	large_file_url: string;
	preview_file_url: string;
}

export const WikiPopup = observer(function WikiPopupComponent() {
	const tag = wikiPopupState.tag;
	const [previewData, setPreviewData] = useState<PostData[] | null>(null);

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

	if (tag === null || !(tag.name in wikiPages)) {
		return null;
	}

	const wikiPagesTyped = wikiPages as Record<string, DTextTag[]>;
	const tagDText = wikiPagesTyped[tag.name];

	return (
		<Popup onClose={() => popupsState.removePopup(PopupStates.Wiki)} title={tag.name} className="wiki-popup">
			<div className="wiki-popup-body-content">
				<DTextDisplay dtext={tagDText} />
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
