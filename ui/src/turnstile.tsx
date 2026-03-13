/// <reference types="cloudflare-turnstile" />
import React, { useEffect, useRef, useState } from "react";

interface TurnstileProps {
	siteKey: string;
	onSuccess: (token: string) => void;
	onError?: () => void;
	action?: string;
	cData?: string;
}

declare global {
	interface Window {
		turnstile?: Turnstile.Turnstile;
	}
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";


function ensureTurnstileScript(): Promise<void> {
	return new Promise((resolve, reject) => {
		// Already available
		if (window.turnstile) {
			resolve();
			return;
		}

		// Reuse an existing script if one is already being loaded
		const existing = document.querySelector<HTMLScriptElement>(
			`script[src="${TURNSTILE_SRC}"]`,
		);

		if (existing) {
			existing.addEventListener("load", () => resolve(), { once: true });
			existing.addEventListener(
				"error",
				() => reject(new Error("Failed to load Turnstile script")),
				{ once: true },
			);
			return;
		}

		const script = document.createElement("script");
		script.src = TURNSTILE_SRC;
		script.defer = true;

		script.addEventListener("load", () => resolve(), { once: true });
		script.addEventListener(
			"error",
			() => reject(new Error("Failed to load Turnstile script")),
			{ once: true },
		);

		document.head.appendChild(script);
	});
}


const Turnstile: React.FC<TurnstileProps> = ({ siteKey, onSuccess, onError, action, cData }) => {
	const ref = useRef<HTMLDivElement>(null);
	const widgetIdRef = useRef<string | null>(null);
	const [scriptReady, setScriptReady] = useState(false);
	const [scriptError, setScriptError] = useState<Error | null>(null);

	useEffect(() => {
		let cancelled = false;

		ensureTurnstileScript()
			.then(() => {
				if (!cancelled) {
					setScriptError(null);
					setScriptReady(true);
				}
			})
			.catch((err: Error) => {
				if (!cancelled) {
					setScriptError(err);
					onError?.();
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (scriptError) {
			console.error("Failed to load Turnstile:", scriptError);
			return;
		}

		if (!scriptReady || !window.turnstile || !ref.current) {
			return;
		}

		// Remove old widget before re-rendering if props changed
		if (widgetIdRef.current !== null) {
			window.turnstile.remove(widgetIdRef.current);
			widgetIdRef.current = null;
		}

		widgetIdRef.current = window.turnstile.render(ref.current, {
			sitekey: siteKey,
			callback: onSuccess,
			"error-callback": onError,
			action,
			cData,
		}) as string;

		return () => {
			if (widgetIdRef.current !== null && window.turnstile) {
				window.turnstile.remove(widgetIdRef.current);
				widgetIdRef.current = null;
			}
		};
	}, [scriptReady, scriptError, siteKey, onSuccess, onError, action, cData]);

	return <div ref={ref} />;
};

export default Turnstile;
