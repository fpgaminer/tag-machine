import { observer } from "mobx-react";
import ImageControls from "./ImageControls";
import ImageDisplay, { BoundingBox } from "./ImageDisplay";
import { useEffect, useState } from "react";
import { currentImageState } from "./state/CurrentImage";
import { imageListState } from "./state/ImageList";
import { addImageAttribute, imageResolutionState, toggleImageTag } from "./state";
import { tagListState } from "./state/TagList";
import arrowSync24Filled from "@iconify/icons-fluent/arrow-sync-24-filled";
import { Icon } from "@iconify/react/dist/iconify.js";
import arrowUndo24Filled from "@iconify/icons-fluent/arrow-undo-24-filled";
import imageAltText24Filled from "@iconify/icons-fluent/image-alt-text-24-filled";
import imageAltText24Regular from "@iconify/icons-fluent/image-alt-text-24-regular";

function BoundingBoxMode() {
	const currentImage = currentImageState.image;
	const [boundingBoxes, setBoundingBoxes] = useState<BoundingBox[]>([]);
	const noImagesFound = imageListState.searchList !== null && imageListState.searchList.length == 0;
	const message = noImagesFound ? "No images found" : null;
	const savedBoundingBoxes = JSON.parse(currentImage?.singularAttribute("bounding_boxes") ?? "[]") as BoundingBox[];
	const [fetchingBoundingBoxes, setFetchingBoundingBoxes] = useState(false);
	const noWatermarkTagged = currentImageState.tagMap?.get("no_watermark") !== undefined;
	const isUnsaved = JSON.stringify(savedBoundingBoxes) !== JSON.stringify(boundingBoxes);

	// Reset bounding boxes if the image changes
	useEffect(() => {
		setBoundingBoxes(savedBoundingBoxes);
	}, [currentImage]);

	const onBoundingBoxChange = (boundingBoxes: BoundingBox[]) => {
		setBoundingBoxes(boundingBoxes);
	};

	const onRevertBoundingBoxes = () => {
		setBoundingBoxes(savedBoundingBoxes);
	};

	async function onSaveBoundingBoxes() {
		if (savedBoundingBoxes == boundingBoxes || currentImage === null) {
			return;
		}

		await addImageAttribute(currentImage.id, "bounding_boxes", JSON.stringify(boundingBoxes), true);
	}

	async function onNoWatermarkClicked() {
		const currentImage = currentImageState.image;
		const noWatermarkTag = tagListState.getTagByName("no_watermark");
		if (currentImage === null || noWatermarkTag === null) {
			console.log("No image or tag found");
			return;
		}

		await toggleImageTag(currentImage, noWatermarkTag);
	}

	async function onSuggestBoxes() {
		if (currentImage === null) {
			console.log("No image found");
			return;
		}

		setFetchingBoundingBoxes(true);
		const boxes = await suggestBoxes(currentImage.id);
		setBoundingBoxes(boxes);
		setFetchingBoundingBoxes(false);
	}

	async function onTightenBoxes() {
		if (currentImage === null) {
			console.log("No image found");
			return;
		}

		const boxes = await tightenBoxes(currentImage.id, boundingBoxes);
		setBoundingBoxes(boxes);
	}

	// Global Keyboard Shortcuts
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			console.log("Key pressed: ", event.key);
			const activeElement = document.activeElement as HTMLElement | null;
			const isTyping =
				activeElement &&
				(activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable);

			if (isTyping) {
				return;
			}

			// If user press the N key, add or remove the no watermark tag
			if (event.key === "n") {
				void onNoWatermarkClicked();
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
		<div className="row remainingSpace">
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay
						imageId={currentImage !== null ? currentImage.id : null}
						resolution={imageResolutionState.resolution}
						message={message}
						enableBoundingBoxes={true}
						boundingBoxes={boundingBoxes}
						onBoundingBoxChange={onBoundingBoxChange}
					/>
				</div>
				<div className="row contentBased">
					<ImageControls>
						<div className="control">
							{boundingBoxes.length} bounding box{boundingBoxes.length !== 1 ? "es" : ""}
						</div>
						<div className="control">
							<button className="control-button" title="Suggest bounding boxes" onClick={onSuggestBoxes}>
								Suggest {fetchingBoundingBoxes ? <Icon icon={arrowSync24Filled} className="icon" width="24" /> : null}
							</button>
						</div>
						<div className="control">
							<button className="control-button" title="Tighten bounding boxes" onClick={onTightenBoxes}>
								Tighten
							</button>
						</div>
						<div className="control">
							<button
								className="control-button"
								title={noWatermarkTagged ? "Remove no watermark tag" : "Add no watermark tag"}
								onClick={onNoWatermarkClicked}
							>
								<Icon
									icon={noWatermarkTagged ? imageAltText24Filled : imageAltText24Regular}
									className={`icon ${noWatermarkTagged ? "icon-red" : ""}`}
									width="24"
								/>
							</button>
						</div>
						<div className="control">
							<button className="control-button" title="Revert bounding boxes" onClick={onRevertBoundingBoxes}>
								<Icon icon={arrowUndo24Filled} className="icon" width="24" />
							</button>
						</div>
						<div className="control">
							<button className="control-button" title="Save bounding boxes" onClick={onSaveBoundingBoxes}>
								{isUnsaved ? "Save" : "Unchanged"}
							</button>
						</div>
						<div className="control-separator"></div>
					</ImageControls>
				</div>
			</div>
		</div>
	);
}

export default observer(BoundingBoxMode);

async function suggestBoxes(
	image_id: number,
	prompt: string = "a watermark",
	port: number = 5049,
): Promise<BoundingBox[]> {
	try {
		const response = await fetch(`http://localhost:${port}/yolo`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				image_id: image_id,
				prompt: prompt,
			}),
		});

		const json = (await response.json()) as { boxes: number[][] };
		const boxes = json.boxes.map(
			(box) =>
				({
					left: box[0],
					top: box[1],
					right: box[2],
					bottom: box[3],
					label: "watermark",
				}) as BoundingBox,
		);

		return boxes;
	} catch (e) {
		alert(`Error running owlv2 model: ${String(e)}`);
		return [];
	}
}

async function tightenBoxes(image_id: number, boxes: BoundingBox[], port: number = 5049): Promise<BoundingBox[]> {
	try {
		const boxesArray = boxes.map((box) => [box.left, box.top, box.right, box.bottom]);
		const response = await fetch(`http://localhost:${port}/sam2`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				image_id: image_id,
				boxes: boxesArray,
			}),
		});

		const json = (await response.json()) as { boxes: number[][] };
		const newBoxes = json.boxes.map(
			(box, i) =>
				({
					left: box[0],
					top: box[1],
					right: box[2],
					bottom: box[3],
					label: boxes[i].label,
				}) as BoundingBox,
		);

		return newBoxes;
	} catch (e) {
		alert(`Error running sam2 model: ${String(e)}`);
		return [];
	}
}
