import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageControls from "./ImageControls";
import ImageDisplay from "./ImageDisplay";
import CaptionEditor from "./CaptionEditor";

function TaggingMode() {
	return (
		<div className="row remainingSpace">
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay />
				</div>
				<div className="row contentBased">
					<ImageControls />
				</div>
			</div>
			<div className="column sideColumnLarge spacing-5">
				<ActiveTagList readonly={true} />
				<CaptionEditor />
			</div>
		</div>
	);
}

export default observer(TaggingMode);
