import { observer } from "mobx-react";
import React, { useState } from "react";
import { errorMessageState, login } from "./state";

function LoginWindow() {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [key, setKey] = useState("");

	async function onLoginClicked() {
		try {
			if (key !== "") {
				await login(username, null, key);
			}
			else if (password !== "") {
				await login(username, password, null);
			}
			else {
				errorMessageState.setErrorMessage("Please enter a password or key");
			}
		}
		catch (error) {
			errorMessageState.setErrorMessage(`Error logging in: ${error as string}`);
		}
	}

	return (
		<div className="row remainingSpace">
			<div className="column remainingSpace spacing-5"></div>
			<div className="column spacing-5">
				<div>Username:</div>
				<input type="text" onChange={(e) => setUsername(e.target.value)} value={username} />
				<div>Password:</div>
				<input type="password" onChange={(e) => setPassword(e.target.value)} value={password} />
				<div>Key:</div>
				<input type="password" onChange={(e) => setKey(e.target.value)} value={key} />
				<button onClick={onLoginClicked}>Login</button>
			</div>
			<div className="column remainingSpace spacing-5"></div>
		</div>
	);
}

export default observer(LoginWindow);
