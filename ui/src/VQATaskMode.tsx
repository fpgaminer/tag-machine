import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageDisplay from "./ImageDisplay";
import VQAEditor from "./VQAEditor";
import { useEffect, useRef, useState } from "react";
import TaskControls from "./TaskControls";
import { imageListState } from "./state/ImageList";
import { imageResolutionState } from "./state";
import { vqaTaskQueueState } from "./state/VQATaskQueue";

function VQATaskMode() {
	const initialHeight = parseFloat(localStorage.getItem("layout-vqamode-height") ?? "50");
	const [activeTagListHeight, setActiveTagListHeight] = useState(initialHeight);
	const isResizing = useRef(false);
	const currentImageId = vqaTaskQueueState.currentImageId;
	const currentImage = currentImageId !== null ? imageListState.getImageById(currentImageId) : null;

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

	useEffect(() => {
		void vqaTaskQueueState.initialize();
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const activeElement = document.activeElement as HTMLElement | null;
			const isTyping =
				activeElement &&
				(activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable);

			if (isTyping) {
				return;
			}

			if (event.key === "ArrowLeft") {
				vqaTaskQueueState.goBack();
			} else if (event.key === "ArrowRight") {
				void vqaTaskQueueState.goForward();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	const containerRef = useRef<HTMLDivElement>(null);

	return (
		<div className="row remainingSpace" ref={containerRef}>
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay
						key={`${currentImage?.id ?? "none"}:${imageResolutionState.resolution ?? "original"}`}
						imageId={currentImage !== null ? currentImage.id : null}
						resolution={imageResolutionState.resolution}
						message={"No tasks left"}
					/>
				</div>
				<div className="row contentBased">
					<TaskControls
						taskCounts={vqaTaskQueueState.taskCounts}
						onBackClicked={() => vqaTaskQueueState.goBack()}
						onForwardClicked={() => void vqaTaskQueueState.goForward()}
						onFinishedClicked={() => void vqaTaskQueueState.finishCurrentTask()}
						canGoBack={vqaTaskQueueState.canGoBack}
						canGoForward={!vqaTaskQueueState.isLoadingNextTask && !vqaTaskQueueState.isFinishingCurrentTask}
						canFinish={vqaTaskQueueState.canFinishCurrentTask}
					/>
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

export default observer(VQATaskMode);
