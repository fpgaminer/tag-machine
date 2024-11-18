import { makeAutoObservable } from "mobx";
import * as api from "../api";
import { errorMessageState } from "../state";

class AuthState {
	user_token: string | null = null;
	loggedIn: boolean | null = null;   // Null if we don't know yet
	userInfo: api.ApiUserInfo | null = null;

	constructor() {
		const stored_token = localStorage.getItem("user_token");
		if (stored_token !== null) {
			this.user_token = stored_token;
		}

		makeAutoObservable(this);
	}

	clearToken() {
		this.user_token = null;
		localStorage.removeItem("user_token");
	}

	setToken(token: string) {
		this.user_token = token;
		localStorage.setItem("user_token", token);

		checkIfLoggedIn();
	}

	setLoggedIn(loggedIn: boolean) {
		this.loggedIn = loggedIn;
	}

	setUserInfo(userInfo: api.ApiUserInfo) {
		this.userInfo = userInfo;
	}
}

export const authState = new AuthState();

export async function checkIfLoggedIn() {
	console.log("Checking if logged in");
	if (authState.user_token === null) {
		console.log("No token, not logged in");
		authState.setLoggedIn(false);
		return;
	}

	try {
		const user_info = await api.userInfo("me");
		console.log("User info:", user_info);
		console.log("Setting logged in to", user_info !== null);
		authState.setLoggedIn(user_info !== null);

		if (user_info !== null) {
			authState.setUserInfo(user_info);
		}
	}
	catch (error) {
		authState.setLoggedIn(false);
		errorMessageState.setErrorMessage(`Error checking if logged in: ${error}`);
	}
}