import { useState, useEffect, useRef } from "react";

interface Options<T> {
	/** Synchronize state across tabs/windows */
	sync?: boolean;
	/** Custom serialization function (default: JSON.stringify, or raw string if T is string) */
	serialize?: (value: T) => string;
	/** Custom deserialization function (default: JSON.parse, or raw string if T is string) */
	deserialize?: (value: string) => T;
	/** Debounce time in milliseconds for saving to localStorage */
	debounce?: number;
}

function useLocalStorageState<T>(
	key: string,
	initialValue: T | (() => T),
	options?: Options<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
	const actualInitialValue = initialValue instanceof Function ? initialValue() : initialValue;
	const isString = typeof actualInitialValue === "string";

	const defaultSerialize: (value: T) => string = isString
		? (value) => value as unknown as string
		: (value) => JSON.stringify(value);
	const defaultDeserialize: (value: string) => T = isString
		? (value) => value as unknown as T
		: (value) => JSON.parse(value) as T;
	const { sync = false, serialize = defaultSerialize, deserialize = defaultDeserialize, debounce = 0 } = options || {};

	// Keep track of the previous key to handle key changes
	const prevKeyRef = useRef(key);

	const [state, setState] = useState<T>(() => {
		if (typeof window === "undefined") {
			return initialValue instanceof Function ? initialValue() : initialValue;
		}
		try {
			const item = window.localStorage.getItem(key);
			if (item !== null) {
				return deserialize(item);
			} else {
				return initialValue instanceof Function ? initialValue() : initialValue;
			}
		} catch (error) {
			console.error(`Error reading localStorage key "${key}":`, error);
			return initialValue instanceof Function ? initialValue() : initialValue;
		}
	});

	// Effect to update localStorage when state or key changes
	useEffect(() => {
		if (prevKeyRef.current !== key) {
			prevKeyRef.current = key;
		}

		const saveToLocalStorage = () => {
			try {
				window.localStorage.setItem(key, serialize(state));
			} catch (error) {
				console.error(`Error setting localStorage key "${key}":`, error);
			}
		};

		if (debounce > 0) {
			const timeoutId = setTimeout(saveToLocalStorage, debounce);
			return () => {
				clearTimeout(timeoutId);
			};
		} else {
			saveToLocalStorage();
		}
	}, [key, state, debounce, serialize]);

	// Effect to handle storage events and sync state across tabs
	useEffect(() => {
		if (!sync) return;

		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === key) {
				try {
					const newValue = e.newValue
						? deserialize(e.newValue)
						: initialValue instanceof Function
							? initialValue()
							: initialValue;
					setState(newValue);
				} catch (error) {
					console.error(`Error deserializing localStorage key "${key}":`, error);
				}
			}
		};

		window.addEventListener("storage", handleStorageChange);
		return () => {
			window.removeEventListener("storage", handleStorageChange);
		};
	}, [key, sync, deserialize, initialValue]);

	return [state, setState];
}

export default useLocalStorageState;
