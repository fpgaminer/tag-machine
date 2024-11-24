import { observer } from "mobx-react";
import { PopupStates, WindowStates, popupsState, windowState } from "./state";
import ErrorMessage from "./ErrorMessage";
import Menu from "./Menu";
import TaggingMode from "./TaggingMode";
import CaptionMode from "./CaptionMode";
import LoginWindow from "./LoginWindow";
import VQAMode from "./VQAMode";
import RegisterWindow from "./RegisterWindow";
import VQATaskMode from "./VQATaskMode";
import { ImageInfoPopup } from "./ImageInfoPopup";
import AdminPopup from "./AdminPopup";
import UserPopup from "./UserPopup";
import VQAAIConfigPopup from "./VQAAIConfigPopup";
import { WikiPopup } from "./WikiPopup";
import UploadPopup from "./UploadPopup";

function App() {
	const windowStateState = windowState.state;

	const popups = Array.from(popupsState.popups).map((popup, index) => {
		switch (popup) {
			case PopupStates.ImageInfo:
				return <ImageInfoPopup key={index} />;
			case PopupStates.AdminPanel:
				return <AdminPopup key={index} />;
			case PopupStates.UserSettings:
				return <UserPopup key={index} />;
			case PopupStates.VqaAiSettings:
				return <VQAAIConfigPopup key={index} />;
			case PopupStates.Wiki:
				return <WikiPopup key={index} />;
			case PopupStates.Upload:
				return <UploadPopup key={index} />;
			default:
				throw new Error(`Unknown popup state: ${popup}`);
		}
	});

	return (
		<div className="app-container">
			{popups}
			<div className="column remainingSpace">
				<div className="row contentBased">
					<ErrorMessage />
				</div>
				<div className="row contentBased">
					{windowStateState !== WindowStates.Login && windowStateState !== WindowStates.Register ? <Menu /> : null}
				</div>
				<div className="row remainingSpace spacing-5">
					{windowStateState === WindowStates.Login ? <LoginWindow /> : null}
					{windowStateState === WindowStates.Tagging ? <TaggingMode /> : null}
					{windowStateState === WindowStates.Captioning ? <CaptionMode /> : null}
					{windowStateState === WindowStates.Vqa ? <VQAMode /> : null}
					{windowStateState === WindowStates.Register ? <RegisterWindow /> : null}
					{windowStateState === WindowStates.VqaTasks ? <VQATaskMode /> : null}
				</div>
			</div>
		</div>
	);
}

export default observer(App);
