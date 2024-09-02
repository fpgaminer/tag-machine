import { makeAutoObservable } from "mobx";
import * as api from "../api";
import { errorMessageState } from "../state";

class AuthState {
	user_token: string | null = null;
	loggedIn: boolean | null = null;   // Null if we don't know yet

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
}

export const authState = new AuthState();

export async function checkIfLoggedIn() {
	if (authState.user_token === null) {
		authState.setLoggedIn(false);
		return;
	}

	try {
		const user_info = api.user_info();
		authState.setLoggedIn(user_info !== null);
	}
	catch (error) {
		authState.setLoggedIn(false);
		errorMessageState.setErrorMessage(`Error checking if logged in: ${error}`);
	}
}