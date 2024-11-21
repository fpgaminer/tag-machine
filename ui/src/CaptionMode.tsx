import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageControls from "./ImageControls";
import ImageDisplay from "./ImageDisplay";
import CaptionEditor from "./CaptionEditor";
import { currentImageState } from "./state/CurrentImage";
import { imageListState } from "./state/ImageList";
import { imageResolutionState } from "./state";

function TaggingMode() {
	const currentImage = currentImageState.image;
	const noImagesFound = imageListState.searchList !== null && imageListState.searchList.length == 0;
	const message = noImagesFound ? "No images found" : null;

	return (
		<div className="row remainingSpace">
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay
						imageId={currentImage !== null ? currentImage.id : null}
						resolution={imageResolutionState.resolution}
						message={message}
					/>
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
