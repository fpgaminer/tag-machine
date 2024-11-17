import { observer } from "mobx-react";
import React, { useEffect, useState } from "react";
import { errorMessageState, login, login_key_from_password } from "./state";
import * as api from "./api";
import Turnstile from "./turnstile";

enum RegisterState {
	Idle,
	Creating,
	Success,
}

function RegisterWindow() {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [birthdate, setBirthdate] = useState("");
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const [acknowledgeWarning, setAcknowledgeWarning] = useState(false);
	const [state, setState] = useState(RegisterState.Idle);
	const [turnstileKey, setTurnstileKey] = useState<string | null>(null);
	const [invitecode, setInviteCode] = useState("");

	async function getTurnstileKey() {
		try {
			const key = await api.getCfTurnstileKey();
			setTurnstileKey(key);
		}
		catch (error) {
			errorMessageState.setErrorMessage(`Error getting turnstile key: ${error as string}`);
		}
	}

	useEffect(() => {
		getTurnstileKey();
	}, []);

	async function onRegisterClicked(e: React.MouseEvent) {
		e.preventDefault();

		const birthdateTimestamp = Math.floor(new Date(birthdate).getTime() / 1000);

		if (!acknowledgeWarning) {
			errorMessageState.setErrorMessage("You cannot create an account without consenting to the terms");
			return;
		}

		if (username === "") {
			errorMessageState.setErrorMessage("Please enter a username");
			return;
		}

		if (password === "") {
			errorMessageState.setErrorMessage("Please enter a password");
			return;
		}

		if (turnstileToken === null) {
			errorMessageState.setErrorMessage("Please complete the captcha");
			return;
		}

		if (invitecode === "") {
			errorMessageState.setErrorMessage("Please enter an invitation code");
			return;
		}

		if (birthdateTimestamp === 0 || isNaN(birthdateTimestamp)) {
			errorMessageState.setErrorMessage("Please enter a valid birthdate");
			return;
		}

		setState(RegisterState.Creating);

		// Scrypt the password
		const login_key = await login_key_from_password(username, password);

		try {
			await api.createUser(username, login_key, turnstileToken, birthdateTimestamp, invitecode);
		}
		catch (error) {
			errorMessageState.setErrorMessage(`Error logging in: ${error as string}`);
			setState(RegisterState.Idle);
			return;
		}

		setState(RegisterState.Success);
	}

	function turnstileCallback(token: string) {
		setTurnstileToken(token);
	}

	if (state !== RegisterState.Success) {
		return (
			<div className="row remainingSpace">
				<div className="column remainingSpace spacing-5"></div>
				<div className="column spacing-5 registerFormContainer">
					<form className="row spacing-5 registerForm">
						<h2>Create an Account</h2>
						<p className="legalWarning">
							This website is part of an AI research initiative that involves analyzing and interacting with unfiltered images from the internet. These images may include <b>adult</b> or otherwise sensitive content. By creating an account, you confirm that you are <b>at least 18 years old</b> and agree to use this website responsibly. If you are not comfortable with potentially viewing such material, please do not create an account.
							<div className="content-warning-checkbox">
								<input type="checkbox" id="acknowledge-warning" name="acknowledge-warning" onChange={(e) => setAcknowledgeWarning(e.target.checked)} />
								<label htmlFor="acknowledge-warning">I acknowledge and agree to the terms.</label>
							</div>
						</p>
						<div>
							<label htmlFor="username">Username</label>
							<input type="text" onChange={(e) => setUsername(e.target.value)} value={username} required id="username" name="username" />
						</div>
						<div>
							<label htmlFor="password">Password</label>
							<input type="password" onChange={(e) => setPassword(e.target.value)} value={password} id="password" name="password" required />
						</div>
						<div>
							<label htmlFor="birthdate">Birthdate (for age verification only)</label>
							<input type="date" onChange={(e) => setBirthdate(e.target.value)} value={birthdate} id="birthdate" name="birthdate" required />
						</div>
						<div>
							<label htmlFor="invite_code">Invitation Code</label>
							<input type="text" onChange={(e) => setInviteCode(e.target.value)} value={invitecode} id="invite_code" name="invite_code" required />
						</div>
						{turnstileKey !== null && state === RegisterState.Idle ? <Turnstile siteKey={turnstileKey} onSuccess={turnstileCallback} /> : turnstileKey === null ? <p>ERROR: Unable to load captcha</p> : null}
						<div><button onClick={onRegisterClicked} disabled={(!acknowledgeWarning) || state !== RegisterState.Idle}>Create Account</button></div>
					</form>
				</div>
				<div className="column remainingSpace spacing-5"></div>
			</div>
		);
	} else {
		return (
			<div className="row remainingSpace">
				<div className="column remainingSpace spacing-5"></div>
				<div className="column spacing-5 registerFormContainer">
					<div className="row spacing-5 registerForm">
						<h2>Account Created</h2>
						<p>Your account has been created successfully. An administrator will review your account before activation.</p>
						<p>Thank you for registering.</p>
					</div>
				</div>
				<div className="column remainingSpace spacing-5"></div>
			</div>
		);
	}
}

export default observer(RegisterWindow);
