import { useState, useRef, useEffect } from "react";
import { Tag, favoriteTagsState, toggleImageTag } from "./state";
import { observer } from "mobx-react";
import TagListUI from "./TagListUI";
import { tagListState } from "./state/TagList";
import { currentImageState } from "./state/CurrentImage";

function TagList() {
	const tags = tagListState.tags;
	const fuse = tagListState.fuse;
	const [search, setSearch] = useState<string>("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const currentImage = currentImageState.image;
	let topSearchResult: Tag | null = null;

	function getTagControls(tag: Tag) {
		function onFavoriteClicked() {
			if (tag.favorite) {
				favoriteTagsState.removeFavoriteTag(tag);
			} else {
				favoriteTagsState.addFavoriteTag(tag);
			}
		}

		return (
			<button className="tag-item-control" onClick={onFavoriteClicked}>
				{tag.favorite ? "★" : "☆"}
			</button>
		);
	}

	function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		// Drop focus from the search box when the escape key is pressed
		if (event.key === "Escape") {
			if (searchInputRef.current !== null) {
				searchInputRef.current.blur();
			}
		}
		// Toggle the top search result when the enter key is pressed
		else if (event.key === "Enter") {
			if (topSearchResult !== null && currentImage !== null) {
				void toggleImageTag(currentImage, topSearchResult);
			}
		}
	}

	const handleSearchFocus = () => {
		if (searchInputRef.current !== null) {
			searchInputRef.current.select();
		}
	};

	let contents = <p>Loading...</p>;

	if (tags !== null) {
		// Fuzzy search
		let filteredTags = tags.slice();

		if (search != "" && fuse !== null) {
			filteredTags = fuse.search(search, { limit: 100 }).map((result) => result.item);
		} else {
			// Sort so that favorite tags are at the top
			filteredTags.sort((a, b) => {
				if (a.favorite && !b.favorite) {
					return -1;
				} else if (!a.favorite && b.favorite) {
					return 1;
				} else {
					return a.id - b.id;
				}
			});

			// Limit the number of tags displayed
			filteredTags = filteredTags.slice(0, 256);
		}

		contents = <TagListUI tags={filteredTags} getControls={getTagControls} />;

		if (filteredTags.length > 0) {
			topSearchResult = filteredTags[0];
		}
	}

	useEffect(() => {
		// Add event listener for keydown event
		document.addEventListener("keydown", handleKeyDown);

		// Remove event listener on cleanup
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	const handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === "s" && event.target === document.body) {
			if (searchInputRef.current !== null) {
				searchInputRef.current.focus();

				// Prevent the "s" key from being typed into the search box
				event.preventDefault();
			}
		}
	};

	return (
		<div className="column remainingSpace">
			<div className="contentBased columnHeader">
				<input
					type="text"
					placeholder="Search..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					onFocus={handleSearchFocus}
					onKeyDown={onSearchKeyDown}
					ref={searchInputRef}
				/>
			</div>
			<div className="remainingSpace scrollable">{contents}</div>
		</div>
	);
}

export default observer(TagList);
