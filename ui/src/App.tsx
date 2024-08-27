import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageControls from "./ImageControls";
import ImageDisplay from "./ImageDisplay";
import SuggestedTags from "./SuggestedTags";
import TagList from "./TagList";
import WikiPopup from "./WikiPopup";
import { WindowStates, imageInfoPopupState, uploadPopupState, wikiPopupState, windowState } from "./state";
import ErrorMessage from "./ErrorMessage";
import AssociationTagList from "./TagAssociations";
import Menu from "./Menu";
import ImageInfoPopup from "./ImageInfoPopup";
import UploadPopup from "./UploadPopup";
import TaggingMode from "./TaggingMode";
import CaptionMode from "./CaptionMode";

function App() {
	const wikiPopupVisible = wikiPopupState.visible;
	const wikiPopupTag = wikiPopupState.tag;
	const imageInfoPopupVisible = imageInfoPopupState.visible;
	const imageInfoPopupImage = imageInfoPopupState.image;
	const uploadPopupVisible = uploadPopupState.visible;
	const windowStateState = windowState.state;

	return (
		<div className="app-container">
			{wikiPopupVisible && wikiPopupTag !== null ? <WikiPopup tag={wikiPopupTag} /> : null}
			{imageInfoPopupVisible && imageInfoPopupImage !== null ? <ImageInfoPopup image={imageInfoPopupImage} /> : null}
			{uploadPopupVisible ? <UploadPopup /> : null}
			<div className="column remainingSpace">
				<div className="row contentBased">
					<ErrorMessage />
				</div>
				<div className="row contentBased">
					<Menu />
				</div>
				<div className="row remainingSpace spacing-5">
					{windowStateState === WindowStates.Tagging ? <TaggingMode /> : null}
					{windowStateState === WindowStates.Captioning ? <CaptionMode /> : null}
				</div>
			</div>
		</div>
	);
}

export default observer(App);
