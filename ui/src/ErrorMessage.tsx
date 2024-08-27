import { observer } from "mobx-react";
import { errorMessageState } from "./state";

function ErrorMessage() {
	const error = errorMessageState.errorMessage;

	const closeErrorMessage = () => {
		errorMessageState.setErrorMessage(null);
	};

	if (error !== null) {
		return (
			<div className="error-message" onClick={closeErrorMessage}>
				Error: {error}
			</div>
		);
	}

	return null;
}

export default observer(ErrorMessage);
