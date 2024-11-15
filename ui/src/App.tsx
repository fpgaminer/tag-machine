import { observer } from "mobx-react";
import WikiPopup from "./WikiPopup";
import { WindowStates, imageInfoPopupState, uploadPopupState, wikiPopupState, windowState } from "./state";
import ErrorMessage from "./ErrorMessage";
import Menu from "./Menu";
import ImageInfoPopup from "./ImageInfoPopup";
import UploadPopup from "./UploadPopup";
import TaggingMode from "./TaggingMode";
import CaptionMode from "./CaptionMode";
import LoginWindow from "./LoginWindow";
import VQAMode from "./VQAMode";

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
					{windowStateState !== WindowStates.Login ? <Menu /> : null}
				</div>
				<div className="row remainingSpace spacing-5">
					{windowStateState === WindowStates.Login ? <LoginWindow /> : null}
					{windowStateState === WindowStates.Tagging ? <TaggingMode /> : null}
					{windowStateState === WindowStates.Captioning ? <CaptionMode /> : null}
					{windowStateState === WindowStates.Vqa ? <VQAMode /> : null}
				</div>
			</div>
		</div>
	);
}

export default observer(App);
