import { Tag, wikiPopupState } from "./state";
import wikiPages from "./parsed_tag_pages.json";
import DTextDisplay, { DTextTag } from "./DTextDisplay";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

const DANBOORU_API = "https://danbooru.donmai.us";

interface PostData {
	id: number;
	file_url: string;
	large_file_url: string;
	preview_file_url: string;
}

interface WikiPopupProps {
	tag: Tag;
}

function WikiPopup(props: WikiPopupProps) {
	const { tag } = props;
	const [previewData, setPreviewData] = useState<PostData[] | null>(null);

	function onBackgroundClicked(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		if (e.target === e.currentTarget) {
			wikiPopupState.setWikiPopupVisible(false);
		}
	}

	// Fetch preview posts for this tag
	useEffect(() => {
		async function fetchPreviewData() {
			const response = await fetch(`${DANBOORU_API}/posts.json?tags=${tag.name}&limit=9`);
			const data = (await response.json()) as PostData[];

			// Filter out posts that don't have a preview
			data.filter((post) => post.preview_file_url !== null);

			// Limit to 6 posts
			data.splice(6);

			setPreviewData(data);
		}

		void fetchPreviewData();
	}, [tag]);

	if (!(tag.name in wikiPages)) {
		return null;
	}

	const wikiPagesTyped = wikiPages as Record<string, DTextTag[]>;
	const tagDText = wikiPagesTyped[tag.name];

	return (
		<div className="wiki-popup-background" onClick={onBackgroundClicked}>
			<div className="wiki-popup">
				<div className="wiki-popup-content">
					<div className="wiki-popup-header">
						<div className="wiki-popup-title">{tag.name}</div>
						<div className="wiki-popup-close" onClick={() => wikiPopupState.setWikiPopupVisible(false)}>
							X
						</div>
					</div>
					<div className="wiki-popup-body">
						<div className="wiki-popup-body-content">
							<DTextDisplay dtext={tagDText} />
							<PostPreviews posts={previewData ?? []} />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

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

export default observer(WikiPopup);
