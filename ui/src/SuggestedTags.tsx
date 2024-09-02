import { observer } from "mobx-react";
import { Tag } from "./state";
import TagListUI from "./TagListUI";
import { tagListState } from "./state/TagList";
import { currentImageState } from "./state/CurrentImage";

function TagList() {
	const suggestedTags = currentImageState.suggestedTags;
	const serverDown = currentImageState.serverDown;

	let contents = <p>Loading...</p>;

	if (serverDown === true) {
		contents = <p>Prediction server is currently offline</p>;
	}
	else if (suggestedTags !== null) {
		// Sort by score, descending
		const sortedSuggestions = suggestedTags.slice();
		sortedSuggestions.sort((a, b) => b.score - a.score);

		const tagIdToScoreMap = new Map<number, number>();
		const sortedTags = new Array<Tag>();

		for (const suggestion of sortedSuggestions) {
			const tag = tagListState.getTagByName(suggestion.name);

			if (tag === null) {
				continue;
			}

			sortedTags.push(tag);
			tagIdToScoreMap.set(tag.id, suggestion.score);
		}

		const formatter = (tag: Tag) => {
			const score = tagIdToScoreMap.get(tag.id);

			if (score === undefined) {
				return tag.name;
			}

			const percent = Math.round(score * 100);

			return `${tag.name}: ${percent}`;
		};

		contents = <TagListUI tags={sortedTags} formatter={formatter} />;
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Suggestions</h3>
			</div>
			<div className="remainingSpace scrollable">{contents}</div>
		</div>
	);
}

export default observer(TagList);
