import { observer } from "mobx-react";
import TagListUI from "./TagListUI";
import { currentImageState } from "./state/CurrentImage";
import { imageListState } from "./state/ImageList";

function ActiveTagList(props: { readonly?: boolean }) {
	const tagMap = currentImageState.tagMap;

	let contents = <p>Loading...</p>;

	if (tagMap !== null) {
		const tags = Array.from(tagMap.values());

		contents = <TagListUI tags={tags} readonly={props.readonly} />;
	} else if (imageListState.searchList !== null && imageListState.searchList.length == 0) {
		// Search results are loaded, but no image is selected
		contents = <p></p>;
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Active Tags</h3>
			</div>
			<div className="remainingSpace scrollable">{contents}</div>
		</div>
	);
}

export default observer(ActiveTagList);
