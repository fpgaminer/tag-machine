import { observer } from "mobx-react";
import TagListUI from "./TagListUI";
import { tagAssociationState } from "./state/TagAssociations";
import { Tag } from "./state";

function AssociationTagList() {
	const associations = tagAssociationState.tags;
	const serverDown = tagAssociationState.serverDown;

	let contents = <p>Loading...</p>;

	if (serverDown) {
		contents = <p>Prediction server is currently offline</p>;
	}
	else if (associations !== null) {
		const tags = associations.map((tag) => tag.tag);
		const tagIdToScoreMap = new Map<number, number>();

		for (const suggestion of associations) {
			tagIdToScoreMap.set(suggestion.tag.id, suggestion.probability);
		}

		const formatter = (tag: Tag) => {
			const score = tagIdToScoreMap.get(tag.id);

			if (score === undefined) {
				return tag.name;
			}

			const percent = Math.round(score * 100);

			return `${tag.name}: ${percent}`;
		};

		contents = <TagListUI tags={tags} formatter={formatter} />;
	}

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<h3>Associated Tags</h3>
			</div>
			<div className="remainingSpace scrollable">{contents}</div>
		</div>
	);
}

export default observer(AssociationTagList);
