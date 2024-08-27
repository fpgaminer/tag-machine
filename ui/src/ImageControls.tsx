import chevronLeft24Filled from "@iconify/icons-fluent/chevron-left-24-filled";
import chevronRight24Filled from "@iconify/icons-fluent/chevron-right-24-filled";
import chevronDoubleRight24Filled from "@iconify/icons-fluent/chevron-double-right-16-filled";
import { Icon } from "@iconify/react";
import { observer } from "mobx-react";
import { useEffect, useRef, useState } from "react";
import { imageListState } from "./state/ImageList";
import { currentImageState } from "./state/CurrentImage";
import { errorMessageState } from "./state";

function ImageControls() {
	const [isEditing, setIsEditing] = useState(false);
	const [editedIndex, setEditedIndex] = useState("");
	const currentIndex = currentImageState.searchIndex ?? 0;
	const editedIdInput = useRef<HTMLInputElement>(null);
	const searchListLength = imageListState.searchList.length;

	function onPrevClicked() {
		void currentImageState.previousImage();
	}

	function onNextClicked() {
		void currentImageState.nextImage();
	}

	function onNextUntaggedClicked() {
		void currentImageState.nextUntaggedImage();
	}

	function onCurrentIdDoubleClick(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		setIsEditing(true);
		setEditedIndex((currentIndex + 1).toString());

		setTimeout(() => {
			if (editedIdInput.current !== null) {
				editedIdInput.current.focus();
				editedIdInput.current.select();
			}
		}, 0);

		// Prevent the double click from selecting the current ID
		event.preventDefault();
	}

	function onEditedIdChange(event: React.ChangeEvent<HTMLInputElement>) {
		// Remove any non-numeric characters
		const value = event.target.value.replace(/[^0-9]/g, "");
		setEditedIndex(value);
	}

	function changeCurrentIndex(newIndex: number) {
		if (newIndex < 1) {
			errorMessageState.setErrorMessage(`Error changing current index: index out of bounds`);
			return;
		}

		newIndex -= 1;

		//await imageListState.performSearch(newIndex);

		const newImageId = imageListState.getImageIdByIndexClamped(newIndex);

		if (newImageId === null) {
			errorMessageState.setErrorMessage(`Error changing current index: index not found`);
			return;
		}

		currentImageState.imageId = newImageId;
	}

	function onEditedIdKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter") {
			const editedIndexNumber = parseInt(editedIndex);

			// If the edited ID is valid, set the current image to that ID
			if (editedIndex == editedIndexNumber.toString()) {
				void changeCurrentIndex(editedIndexNumber);
				setIsEditing(false);
			}
		} else if (event.key === "Escape") {
			setIsEditing(false);
		}
	}

	function onEditedIdBlur() {
		setIsEditing(false);
	}

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.target !== document.body) {
				return;
			}

			// If user press the left or right arrow keys, go to the previous or next image
			if (event.key === "ArrowLeft") {
				onPrevClicked();
			} else if (event.key === "ArrowRight") {
				onNextClicked();
			} else if (event.key === "ArrowDown") {
				onNextUntaggedClicked();
			}
		};

		// Add event listener for keydown event
		document.addEventListener("keydown", handleKeyDown);

		// Remove event listener on cleanup
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	return (
		<div className="image-controls row">
			<div className="left-side column contentBased">
				<div>
					{isEditing ? (
						<input
							type="number"
							className="current-id-input"
							value={editedIndex}
							onChange={onEditedIdChange}
							onKeyDown={onEditedIdKeyDown}
							onBlur={onEditedIdBlur}
							ref={editedIdInput}
							autoFocus
						/>
					) : (
						<div className="current-id" onDoubleClick={onCurrentIdDoubleClick}>
							{currentIndex + 1}
						</div>
					)}
					&nbsp;/ {searchListLength}
				</div>
			</div>
			<div className="center column remainingSpace"></div>
			<div className="right-side row contentBased">
				<div className="control">
					<button className="control-button" onClick={onPrevClicked}>
						<Icon icon={chevronLeft24Filled} className="icon" width="24" />
					</button>
				</div>
				<div className="control">
					<button className="control-button" onClick={onNextClicked}>
						<Icon icon={chevronRight24Filled} className="icon" width="24" />
					</button>
				</div>
				<div className="control">
					<button className="control-button" onClick={onNextUntaggedClicked} title="Next untagged image">
						<Icon icon={chevronDoubleRight24Filled} className="icon" width="24" />
					</button>
				</div>
			</div>
		</div>
	);
}

export default observer(ImageControls);
