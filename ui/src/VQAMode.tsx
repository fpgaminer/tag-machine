import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageControls from "./ImageControls";
import ImageDisplay from "./ImageDisplay";
import VQAEditor from "./VQAEditor";
import { useEffect, useRef, useState } from "react";
import { currentImageState } from "./state/CurrentImage";
import { imageListState } from "./state/ImageList";
import { imageResolutionState } from "./state";

function VQAMode() {
	const initialHeight = parseFloat(localStorage.getItem("layout-vqamode-height") ?? "50");
	const [activeTagListHeight, setActiveTagListHeight] = useState(initialHeight);
	const isResizing = useRef(false);
	const currentImage = currentImageState.image;

	const noImagesFound = imageListState.searchList !== null && imageListState.searchList.length == 0;
	const message = noImagesFound ? "No images found" : null;

	const onMouseDown = () => {
		isResizing.current = true;
	};

	const onMouseMove = (e: MouseEvent) => {
		if (!isResizing.current) return;

		const container = containerRef.current;
		if (!container) return;

		const containerHeight = container.getBoundingClientRect().height;
		const offsetY = e.clientY - container.getBoundingClientRect().top;
		let newHeight = (offsetY / containerHeight) * 100;
		newHeight = Math.min(90, Math.max(10, newHeight));
		setActiveTagListHeight(newHeight);
	};

	const onMouseUp = () => {
		if (!isResizing) return;

		isResizing.current = false;
		localStorage.setItem("layout-vqamode-height", activeTagListHeight.toString());
	};

	useEffect(() => {
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);

		return () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		};
	});

	const containerRef = useRef<HTMLDivElement>(null);

	return (
		<div className="row remainingSpace" ref={containerRef}>
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay
						imageId={currentImage !== null ? currentImage.id : null}
						resolution={imageResolutionState.resolution}
						message={message}
					/>
				</div>
				<div className="row contentBased">
					<ImageControls />
				</div>
			</div>
			<div className="column sideColumnLarge spacing-5">
				<div className="resizable-panel" style={{ flex: `0 0 ${activeTagListHeight}%` }}>
					<ActiveTagList readonly={true} />
				</div>
				<div className="divider horizontal-divider" onMouseDown={onMouseDown} />
				<div className="resizable-panel" style={{ flex: 1 }}>
					{currentImage !== null ? <VQAEditor currentImage={currentImage} /> : null}
				</div>
			</div>
		</div>
	);
}

export default observer(VQAMode);
