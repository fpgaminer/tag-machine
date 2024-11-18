import { adminPanelPopupState, errorMessageState, login_key_from_password, uploadPopupState, userSettingsPopupState } from "./state";
import { observer } from "mobx-react";
import { useRef, useState, useEffect } from "react";
import * as api from "./api";
import { listUsers } from "./api";
import { authState } from "./state/Auth";

function AdminPopup() {
	const [users, setUsers] = useState<api.ApiUserInfo[]>([]);
	const [invalidatingTokens, setInvalidatingTokens] = useState<Set<number>>(new Set());
	const [activating, setActivating] = useState<Set<number>>(new Set());
	const [edittingScopes, setEdittingScopes] = useState<number | null>(null);
	const [scopeEdit, setScopeEdit] = useState<string>("");

	async function fetchUsersList() {
		try {
			setUsers(await listUsers());
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to get user info: ${error as string}`);
		}
	}

	useEffect(() => {
		fetchUsersList();
	}, []);

	function onBackgroundClicked(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		if (e.target === e.currentTarget) {
			adminPanelPopupState.setVisible(false);
		}
	}

	async function invalidateTokens(userId: number) {
		setInvalidatingTokens((prevInvalidatingTokens) => {
			const newInvalidatingTokens = new Set(prevInvalidatingTokens);
			newInvalidatingTokens.add(userId);
			return newInvalidatingTokens;
		});

		try {
			// Function to invalidate tokens for the user's tokens
			const userTokens = await api.listUserTokens(userId);

			// Invalidate each token
			for (const token of userTokens) {
				await api.invalidateUserToken(token);
			}
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to get user tokens: ${error as string}`);
		}

		setInvalidatingTokens((prevInvalidatingTokens) => {
			const newInvalidatingTokens = new Set(prevInvalidatingTokens);
			newInvalidatingTokens.delete(userId);
			return newInvalidatingTokens;
		});
	}

	async function activateUser(userId: number) {
		setActivating((prevActivating) => {
			const newActivating = new Set(prevActivating);
			newActivating.add(userId);
			return newActivating;
		});

		try {
			const userInfo = await api.userInfo(userId);
			if (userInfo === null) {
				errorMessageState.setErrorMessage(`Failed to get user info: not logged in`);
				return;
			}
			const scopes = new Set(userInfo.scopes.split(",").map((scope) => scope.trim()));
			scopes.add("post/users/" + userId + "/tokens");
			const new_scopes = Array.from(scopes).join(", ");
			await api.changeUserScopes(userId, new_scopes);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to activate user: ${error as string}`);
		}

		setActivating((prevActivating) => {
			const newActivating = new Set(prevActivating);
			newActivating.delete(userId);
			return newActivating;
		});

		await fetchUsersList();
	}

	async function deactivateUser(userId: number) {
		setActivating((prevActivating) => {
			const newActivating = new Set(prevActivating);
			newActivating.add(userId);
			return newActivating;
		});

		try {
			const userInfo = await api.userInfo(userId);
			if (userInfo === null) {
				errorMessageState.setErrorMessage(`Failed to get user info: not logged in`);
				return;
			}
			const scopes = new Set(userInfo.scopes.split(",").map((scope) => scope.trim()));
			scopes.delete("post/users/" + userId + "/tokens");
			const new_scopes = Array.from(scopes).join(", ");
			await api.changeUserScopes(userId, new_scopes);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to deactivate user: ${error as string}`);
		}

		setActivating((prevActivating) => {
			const newActivating = new Set(prevActivating);
			newActivating.delete(userId);
			return newActivating;
		});

		fetchUsersList();
	}

	async function onScopesDoubleClick(userId: number) {
		try {
			const userInfo = await api.userInfo(userId);
			if (userInfo === null) {
				errorMessageState.setErrorMessage(`Failed to get user info: not logged in`);
				return;
			}
			setScopeEdit(userInfo.scopes);
			setEdittingScopes(userId);
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to get user info: ${error as string}`);
		}
	}

	function onScopeEditLostFocus() {
		setEdittingScopes(null);
	}

	async function onScopeEditKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter") {
			const newScopes = scopeEdit;
			const userId = edittingScopes;

			if (userId === null) {
				return;
			}

			try {
				await api.changeUserScopes(userId, newScopes);
			} catch (error) {
				errorMessageState.setErrorMessage(`Failed to change user scopes: ${error as string}`);
			}

			setEdittingScopes(null);
			fetchUsersList();
		} else if (event.key === "Escape") {
			setEdittingScopes(null);
		}
	}

	const userElements = users.map((user, index) => {
		const invalidating = invalidatingTokens.has(user.id);
		const isActivating = activating.has(user.id);
		const isActive = user.scopes.includes("post/users/" + user.id + "/tokens");
		const isEditingScopes = edittingScopes === user.id;

		return (
			<div key={index} className={`user-item`}>
				<div className="user-item-id">{user.id}</div>
				<div className="user-item-username">{user.username}</div>
				{isEditingScopes ?
					<div className="user-item-scopes">
						<input type="text" value={scopeEdit} onChange={(e) => setScopeEdit(e.target.value)} onBlur={onScopeEditLostFocus} onKeyDown={onScopeEditKeyDown} />
					</div> :
					<div className="user-item-scopes" onDoubleClick={() => onScopesDoubleClick(user.id)}>{user.scopes}</div>
				}
				<div className="user-item-buttons">
					<button onClick={() => invalidateTokens(user.id)} disabled={invalidating}>Delete Tokens</button>
					{isActive ?
						<button onClick={() => deactivateUser(user.id)} disabled={isActivating}>Deactivate</button> :
						<button onClick={() => activateUser(user.id)} disabled={isActivating}>Activate</button>
					}
				</div>
			</div>
		);
	});

	return (
		<div className="popup-background" onClick={onBackgroundClicked}>
			<div className="popup-window admin-popup-window">
				<div className="popup-window-content">
					<div className="popup-window-header">
						<div className="popup-window-title">Admin</div>
						<div className="popup-window-close" onClick={() => adminPanelPopupState.setVisible(false)}>
							&times;
						</div>
					</div>
					<div className="popup-window-body">
						<div className="popup-window-body-content">
							<div className="admin-window-section">
								<h2>Users</h2>
								<div className="user-list">
									<div className="user-list-header">
										<div className="user-item-id">ID</div>
										<div className="user-item-username">Username</div>
										<div className="user-item-scopes">Scopes</div>
									</div>
									{userElements}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default observer(AdminPopup);

async function asyncConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		if (window.confirm(message)) {
			resolve(true);
		} else {
			resolve(false);
		}
	});
}