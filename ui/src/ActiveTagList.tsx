import { observer } from "mobx-react";
import TagListUI from "./TagListUI";
import { currentImageState } from "./state/CurrentImage";

function ActiveTagList() {
	const tagMap = currentImageState.tagMap;

	let contents = <p>Loading...</p>;

	if (tagMap !== null) {
		const tags = Array.from(tagMap.values());

		contents = <TagListUI tags={tags} />;
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
