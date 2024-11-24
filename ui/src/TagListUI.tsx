import { popupsState, PopupStates, Tag, toggleImageTag } from "./state";
import { observer } from "mobx-react";
import { currentImageState } from "./state/CurrentImage";
import { wikiPopupState } from "./WikiPopup";

interface TagListUIProps {
	tags: Tag[];
	formatter?: (tag: Tag) => string;
	getControls?: (tag: Tag) => JSX.Element;
	readonly?: boolean;
}

function TagListUI(props: TagListUIProps) {
	const tags = props.tags;
	const currentImage = currentImageState.image;
	const currentImageTagMap = currentImageState.tagMap;

	function onTagClicked(tag: Tag) {
		if (props.readonly || currentImage === null) {
			return;
		}

		void toggleImageTag(currentImage, tag);
	}

	function onTagRightClicked(tag: Tag) {
		wikiPopupState.setTag(tag);
		popupsState.addPopup(PopupStates.Wiki);
	}

	// Tag UI
	const tagItems = tags.map((tag) => {
		const isActive = currentImageTagMap === null ? false : currentImageTagMap.has(tag.name);
		const text = props.formatter ? props.formatter(tag) : tag.name;

		return (
			<li key={tag.id} title={tag.name} className={isActive ? "tag-item active" : "tag-item"}>
				<p
					onClick={() => onTagClicked(tag)}
					onContextMenu={(e) => {
						e.preventDefault();
						onTagRightClicked(tag);
					}}
				>
					{text}
				</p>
				<div className="tag-item-controls">{props.getControls ? props.getControls(tag) : null}</div>
			</li>
		);
	});

	return (
		<div className="tag-list">
			<ul>{tagItems}</ul>
		</div>
	);
}

export default observer(TagListUI);
