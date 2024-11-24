import { errorMessageState, login_key_from_password, popupsState, PopupStates } from "./state";
import { observer } from "mobx-react";
import { useState, useEffect } from "react";
import * as api from "./api";
import { userInfo } from "./api";
import { authState } from "./state/Auth";
import Popup from "./Popup";

function UserPopup() {
	const [username, setUsername] = useState<string>("");
	const [tokens, setTokens] = useState<string[]>([]);
	const [checkedTokens, setCheckedTokens] = useState<Set<string>>(new Set());
	const activeToken = authState.user_token;
	const [newPassword, setNewPassword] = useState<string>("");
	const [confirmPassword, setConfirmPassword] = useState<string>("");
	const [password, setPassword] = useState<string>("");
	const [newToken, setNewToken] = useState<string | null>(null);

	async function fetchUserInfo() {
		try {
			const info = await userInfo("me");

			if (info === null) {
				errorMessageState.setErrorMessage("Failed to get user info: not logged in");
				return;
			}

			setUsername(info.username);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to get user info: ${error as string}`);
		}
	}

	async function fetchUserTokens() {
		try {
			const tokens = await api.listUserTokens("me");

			setTokens(tokens);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to get user tokens: ${error as string}`);
		}
	}

	useEffect(() => {
		void fetchUserInfo();
		void fetchUserTokens();
	}, []);

	function handleTokenCheckboxChange(token: string) {
		setCheckedTokens((prevCheckedtokens) => {
			const newCheckedtokens = new Set(prevCheckedtokens);
			if (newCheckedtokens.has(token)) {
				newCheckedtokens.delete(token);
			} else {
				newCheckedtokens.add(token);
			}
			return newCheckedtokens;
		});
	}

	async function invalidateCheckedTokens() {
		if (checkedTokens.size === 0) {
			return;
		}

		if (!(await asyncConfirm("Are you sure you want to invalidate the selected tokens?"))) {
			return;
		}

		try {
			setCheckedTokens(new Set());

			for (const token of checkedTokens) {
				await api.invalidateUserToken(token);
				await fetchUserTokens();
			}
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to invalidate tokens: ${error as string}`);
		}
	}

	async function logoutUser() {
		// Invalidate the active token
		if (activeToken === null) {
			return;
		}

		try {
			await api.invalidateUserToken(activeToken);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to invalidate token: ${error as string}`);
		}

		authState.clearToken();
		authState.setLoggedIn(false);
		popupsState.removePopup(PopupStates.UserSettings);
	}

	async function changeUserPassword() {
		if (newPassword === "") {
			errorMessageState.setErrorMessage("Please enter a new password");
			return;
		}

		if (newPassword !== confirmPassword) {
			errorMessageState.setErrorMessage("Passwords do not match");
			return;
		}

		if (!(await asyncConfirm("Are you sure you want to change your password?"))) {
			return;
		}

		try {
			const login_key = await login_key_from_password(username, newPassword); //

			await api.changeUserLoginKey(login_key);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to change password: ${error as string}`);
		}

		setNewPassword("");
		setConfirmPassword("");

		await asyncAlert("Password changed successfully");
	}

	async function createNewUserToken() {
		try {
			const login_key = await login_key_from_password(username, password);
			const new_token = await api.login(username, login_key);
			setNewToken(new_token);
			await fetchUserTokens();
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to create new token: ${error as string}`);
		}
	}

	const tokenElements = tokens.map((token, index) => {
		return (
			<div key={index} className={`token-item ${token === activeToken ? "active" : ""}`}>
				<input type="checkbox" checked={checkedTokens.has(token)} onChange={() => handleTokenCheckboxChange(token)} />
				<span className="token-value">{token}</span>
			</div>
		);
	});

	return (
		<Popup onClose={() => popupsState.removePopup(PopupStates.UserSettings)} title="User Settings" className="user-popup">
			<div className="popup-window-body-content">
				<div className="user-settings-section">
					<h2>Account Information</h2>
					<p>
						<strong>Username:</strong> {username}
					</p>
					<button className="logout-button" onClick={logoutUser}>
						Logout
					</button>
				</div>

				<div className="user-settings-section">
					<h2>Change Password</h2>
					<div className="input-group">
						<label htmlFor="new-password">New Password</label>
						<input
							type="password"
							placeholder=" "
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
						/>
					</div>
					<div className="input-group">
						<label htmlFor="confirm-password">Confirm Password</label>
						<input
							type="password"
							placeholder=" "
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
						/>
					</div>
					<button onClick={changeUserPassword}>Change Password</button>
				</div>

				<div className="user-settings-section">
					<h2>API Tokens</h2>
					<div className="input-group">
						<label htmlFor="password">Password</label>
						<input
							type="password"
							placeholder="Enter your password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
					<button onClick={createNewUserToken}>Create New Token</button>
					{newToken && (
						<div className="new-token-display">
							<p>
								<strong>New Token:</strong>
							</p>
							<p className="token-value">{newToken}</p>
						</div>
					)}
					<div className="token-list">{tokenElements}</div>
					<button className="invalidate-button" onClick={invalidateCheckedTokens}>
						Invalidate Selected Tokens
					</button>
				</div>
			</div>
		</Popup>
	);
}

export default observer(UserPopup);

async function asyncConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		if (window.confirm(message)) {
			resolve(true);
		} else {
			resolve(false);
		}
	});
}

async function asyncAlert(message: string): Promise<void> {
	return new Promise((resolve) => {
		window.alert(message);
		resolve();
	});
}
