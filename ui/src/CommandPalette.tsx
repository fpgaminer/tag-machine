import { Icon } from "@iconify-icon/react";
import Fuse from "fuse.js";
import React, {
	createContext,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import useLocalStorageState from "./useLocalStateStorage";

const COMMAND_PALETTE_RECENTS_STORAGE_KEY = "command-palette-recent-commands";
const MAX_RECENT_COMMANDS = 8;

export interface CommandPaletteCommand {
	id: string;
	title: string;
	action: () => void | Promise<void>;
	keywords?: string[];
	disabled?: boolean;
	isAvailable?: boolean;
}

interface CommandPaletteSection {
	label: string;
	commands: CommandPaletteCommand[];
}

interface SearchableCommand {
	command: CommandPaletteCommand;
	title: string;
	keywords: string;
}

interface CommandPaletteContextValue {
	registerCommands: (sourceId: string, commands: CommandPaletteCommand[]) => void;
	unregisterCommands: (sourceId: string) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPaletteCommands(commands: CommandPaletteCommand[]) {
	const context = useContext(CommandPaletteContext);
	if (context === null) {
		throw new Error("useCommandPaletteCommands must be used within a CommandPaletteProvider");
	}

	const sourceId = useId();

	useEffect(() => {
		context.registerCommands(sourceId, commands);

		return () => {
			context.unregisterCommands(sourceId);
		};
	}, [commands, context, sourceId]);
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [registeredCommands, setRegisteredCommands] = useState<Record<string, CommandPaletteCommand[]>>({});
	const [recentCommandIds, setRecentCommandIds] = useLocalStorageState<string[]>(
		COMMAND_PALETTE_RECENTS_STORAGE_KEY,
		[],
		{
			sync: true,
		},
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const contextValue = useMemo<CommandPaletteContextValue>(
		() => ({
			registerCommands: (sourceId, commands) => {
				setRegisteredCommands((previous) => {
					if (previous[sourceId] === commands) {
						return previous;
					}

					return {
						...previous,
						[sourceId]: commands,
					};
				});
			},
			unregisterCommands: (sourceId) => {
				setRegisteredCommands((previous) => {
					if (!(sourceId in previous)) {
						return previous;
					}

					const next = { ...previous };
					delete next[sourceId];
					return next;
				});
			},
		}),
		[],
	);

	const availableCommands = useMemo(() => {
		const mergedCommands = new Map<string, CommandPaletteCommand>();

		for (const sourceCommands of Object.values(registeredCommands)) {
			for (const command of sourceCommands) {
				if (command.isAvailable === false) {
					continue;
				}

				mergedCommands.set(command.id, command);
			}
		}

		return Array.from(mergedCommands.values()).sort((left, right) => left.title.localeCompare(right.title));
	}, [registeredCommands]);

	const searchableCommands = useMemo<SearchableCommand[]>(
		() =>
			availableCommands.map((command) => ({
				command,
				title: command.title,
				keywords: command.keywords?.join(" ") ?? "",
			})),
		[availableCommands],
	);

	const fuse = useMemo(
		() =>
			new Fuse(searchableCommands, {
				includeScore: true,
				threshold: 0.4,
				ignoreLocation: true,
				keys: [
					{ name: "title", weight: 0.75 },
					{ name: "keywords", weight: 0.25 },
				],
			}),
		[searchableCommands],
	);

	const sections = useMemo<CommandPaletteSection[]>(() => {
		const trimmedQuery = query.trim();

		if (trimmedQuery === "") {
			const recentCommands = recentCommandIds
				.map((commandId) => availableCommands.find((command) => command.id === commandId) ?? null)
				.filter((command): command is CommandPaletteCommand => command !== null);
			const recentCommandIdsSet = new Set(recentCommands.map((command) => command.id));
			const remainingCommands = availableCommands.filter((command) => !recentCommandIdsSet.has(command.id));
			const nextSections: CommandPaletteSection[] = [];

			if (recentCommands.length > 0) {
				nextSections.push({ label: "Recent", commands: recentCommands });
			}

			nextSections.push({ label: "All Commands", commands: remainingCommands });
			return nextSections;
		}

		const matchingCommands = fuse.search(trimmedQuery, { limit: 50 }).map((result) => result.item.command);
		return [{ label: "Results", commands: matchingCommands }];
	}, [availableCommands, fuse, query, recentCommandIds]);

	const visibleCommands = useMemo(() => sections.flatMap((section) => section.commands), [sections]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const nextIndex = visibleCommands.length === 0 ? 0 : Math.min(activeIndex, visibleCommands.length - 1);
		if (nextIndex !== activeIndex) {
			setActiveIndex(nextIndex);
		}
	}, [activeIndex, isOpen, visibleCommands.length]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		setActiveIndex(0);
		itemRefs.current = [];

		const focusInput = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		return () => {
			window.cancelAnimationFrame(focusInput);
		};
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, isOpen]);

	useEffect(() => {
		const handleGlobalKeyDown = (event: KeyboardEvent) => {
			if (isPaletteShortcut(event)) {
				event.preventDefault();
				event.stopPropagation();
				setIsOpen(true);
				return;
			}

			if (event.key === "F1") {
				event.preventDefault();
				event.stopPropagation();
				setIsOpen(true);
			}
		};

		window.addEventListener("keydown", handleGlobalKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleGlobalKeyDown, true);
		};
	}, []);

	function closePalette() {
		setIsOpen(false);
		setQuery("");
		setActiveIndex(0);
	}

	async function runCommand(command: CommandPaletteCommand) {
		if (command.disabled) {
			return;
		}

		setRecentCommandIds((previous) =>
			[command.id, ...previous.filter((commandId) => commandId !== command.id)].slice(0, MAX_RECENT_COMMANDS),
		);
		closePalette();
		try {
			await command.action();
		} catch (error) {
			console.error(`Error running command "${command.title}":`, error);
		}
	}

	function handlePaletteKeyDown(event: ReactKeyboardEvent<HTMLDivElement | HTMLInputElement>) {
		event.stopPropagation();

		if (event.key === "Escape") {
			event.preventDefault();
			closePalette();
			return;
		}

		if (visibleCommands.length === 0) {
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((previous) => (previous + 1) % visibleCommands.length);
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((previous) => (previous - 1 + visibleCommands.length) % visibleCommands.length);
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			void runCommand(visibleCommands[activeIndex]);
		}
	}

	let globalIndex = 0;

	return (
		<CommandPaletteContext.Provider value={contextValue}>
			{children}
			{isOpen ? (
				<div
					className="command-palette-backdrop"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) {
							closePalette();
						}
					}}
				>
					<div className="command-palette" onKeyDown={handlePaletteKeyDown}>
						<div className="command-palette-search">
							<Icon icon="fluent:search-24-regular" />
							<input
								ref={inputRef}
								type="text"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={handlePaletteKeyDown}
								placeholder={`Type a command... (${getCommandPaletteShortcutLabel()})`}
							/>
						</div>
						<div className="command-palette-results">
							{visibleCommands.length === 0 ? (
								<div className="command-palette-empty">No commands found.</div>
							) : (
								sections.map((section) => {
									if (section.commands.length === 0) {
										return null;
									}

									return (
										<div key={section.label} className="command-palette-section">
											<div className="command-palette-section-label">{section.label}</div>
											{section.commands.map((command) => {
												const commandIndex = globalIndex;
												globalIndex += 1;

												return (
													<button
														key={command.id}
														ref={(element) => {
															itemRefs.current[commandIndex] = element;
														}}
														type="button"
														className={"command-palette-item" + (commandIndex === activeIndex ? " active" : "")}
														disabled={command.disabled}
														onMouseEnter={() => setActiveIndex(commandIndex)}
														onClick={() => {
															void runCommand(command);
														}}
													>
														<span className="command-palette-item-title">{command.title}</span>
														{section.label === "Recent" ? (
															<span className="command-palette-item-badge">Recent</span>
														) : null}
													</button>
												);
											})}
										</div>
									);
								})
							)}
						</div>
					</div>
				</div>
			) : null}
		</CommandPaletteContext.Provider>
	);
}

function isPaletteShortcut(event: KeyboardEvent): boolean {
	if (!event.shiftKey || event.key.toLowerCase() !== "p") {
		return false;
	}

	return isMacPlatform() ? event.ctrlKey : event.ctrlKey || event.metaKey;
}

function getCommandPaletteShortcutLabel(): string {
	return "Ctrl+Shift+P";
}

function isMacPlatform(): boolean {
	return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
