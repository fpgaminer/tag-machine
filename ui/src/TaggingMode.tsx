import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageControls from "./ImageControls";
import ImageDisplay from "./ImageDisplay";
import SuggestedTags from "./SuggestedTags";
import TagList from "./TagList";
import AssociationTagList from "./TagAssociations";

function TaggingMode() {
	return (
		<div className="row remainingSpace">
			<div className="column sideColumn spacing-5">
				<TagList />
				<SuggestedTags />
			</div>
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay />
				</div>
				<div className="row contentBased">
					<ImageControls />
				</div>
			</div>
			<div className="column sideColumn spacing-5">
				<ActiveTagList />
				<AssociationTagList />
			</div>
		</div>
	);
}

export default observer(TaggingMode);
