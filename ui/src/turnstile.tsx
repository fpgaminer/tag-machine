import React, { useEffect, useRef } from "react";
import useScript from "react-script-hook";

interface TurnstileProps {
	siteKey: string;
	onSuccess: (token: string) => void;
	onError?: () => void;
	action?: string;
	cData?: string;
}

declare global {
	interface Window {
		turnstile?: any;
	}
}

const Turnstile: React.FC<TurnstileProps> = ({
	siteKey,
	onSuccess,
	onError,
	action,
	cData,
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const widgetIdRef = useRef<string | null>(null);

	const [loading, error] = useScript({
		src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
		checkForExisting: true,
	});

	useEffect(() => {
		if (error) {
			console.error("Failed to load Turnstile:", error);
			onError && onError();
			return;
		}

		if (!loading && window.turnstile && ref.current && widgetIdRef.current === null) {
			widgetIdRef.current = window.turnstile.render(ref.current, {
				sitekey: siteKey,
				callback: onSuccess,
				'error-callback': onError,
				action,
				cData,
			});
		}

		return () => {
			if (widgetIdRef.current !== null) {
				window.turnstile.remove(widgetIdRef.current);
				widgetIdRef.current = null;
			}
		};
	}, [loading, error]);

	return <div ref={ref} />;
};

export default Turnstile;