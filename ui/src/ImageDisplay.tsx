import { observer } from "mobx-react";
import { errorMessageState, imageIdToUrl } from "./state";
import { ReactZoomPanPinchRef, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import React, { useEffect, useRef, useState } from "react";
import { authState } from "./state/Auth";
import { currentImageState } from "./state/CurrentImage";
import * as api from "./api";

// Inclusive bounding box.
// The smallest box is when left == right (or top == bottom), which is a width/height of 1.
export interface BoundingBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
	label: string;
}

// imageId and resolution must _not_ change. Instead key the component with imageId and resolution so the entire component is recreated when they change.
function ImageDisplay({
	imageId,
	resolution,
	message,
	enableBoundingBoxes,
	boundingBoxes,
	onBoundingBoxChange,
}: {
	imageId: number | null;
	resolution: number | null;
	message: React.ReactNode | null;
	enableBoundingBoxes?: boolean;
	boundingBoxes?: BoundingBox[];
	onBoundingBoxChange?: (boundingBoxes: BoundingBox[]) => void;
}) {
	const [imageData, setImageData] = useState<string | null>(null);
	const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const userLoggedIn = authState.user_token !== null;
	const transformRef = useRef<ReactZoomPanPinchRef>(null);

	useEffect(() => {
		if (!userLoggedIn || imageId === null) {
			currentImageState.displayedImageId = null;
			return;
		}

		const controller = new AbortController();
		let objectUrl: string | null = null;

		currentImageState.displayedImageId = imageId;
		setIsLoading(true);

		async function run(imageId: number) {
			try {
				let url = imageIdToUrl(imageId);
				if (resolution !== null) {
					url += `?size=${resolution}`;
				}

				const response = await api.authenticatedFetch(url, { method: "GET", signal: controller.signal });

				if (!response.ok) {
					throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
				}

				const blob = await response.blob();
				objectUrl = URL.createObjectURL(blob);

				if (controller.signal.aborted) {
					URL.revokeObjectURL(objectUrl);
					objectUrl = null;
					return;
				}

				setImageData(objectUrl);
			} catch (error) {
				if (controller.signal.aborted) {
					return;
				}

				errorMessageState.setErrorMessage(
					`Error fetching image: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				if (!controller.signal.aborted) {
					setIsLoading(false);
				}
			}
		}

		void run(imageId);

		return () => {
			controller.abort();

			if (objectUrl !== null) {
				URL.revokeObjectURL(objectUrl);
			}

			currentImageState.displayedImageId = null;
		};
	}, []);

	const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
		const { naturalWidth, naturalHeight } = e.currentTarget;
		setImgSize({ width: naturalWidth, height: naturalHeight });
		transformRef.current?.resetTransform();
		currentImageState.displayedImageId = imageId;
	};

	const handleBoundingBoxAdd = (boundingBox: BoundingBox) => {
		if (!onBoundingBoxChange || !imgSize) {
			return;
		}

		onBoundingBoxChange(clampBoundingBoxes([...(boundingBoxes ?? []), boundingBox], imgSize));
	};

	let contents: React.ReactNode = null;

	if (imageData !== null) {
		contents = (
			<TransformWrapper
				initialScale={1}
				initialPositionX={0}
				initialPositionY={0}
				limitToBounds={true}
				ref={transformRef}
				maxScale={16}
			>
				{(utils) => {
					const { scale } = utils.instance.transformState;
					const contentComponentRect = utils.instance.contentComponent?.getBoundingClientRect();

					return (
						<TransformComponent>
							<img src={imageData} onLoad={handleImageLoad} alt="" />
							{enableBoundingBoxes && onBoundingBoxChange && imgSize && contentComponentRect ? (
								<BoundingBoxAdder
									onBoundingBoxAdd={handleBoundingBoxAdd}
									scale={scale}
									imgSize={imgSize}
									parentSize={contentComponentRect}
								/>
							) : null}
							{enableBoundingBoxes && boundingBoxes && onBoundingBoxChange && imgSize && contentComponentRect
								? boundingBoxes.map((boundingBox, index) => {
										return (
											<BoundingBoxOverlay
												key={index}
												boundingBox={boundingBox}
												onBoundingBoxChange={(newBoundingBox) => {
													if (newBoundingBox === null) {
														const newBoundingBoxes = [...boundingBoxes];
														newBoundingBoxes.splice(index, 1);
														onBoundingBoxChange(clampBoundingBoxes(newBoundingBoxes, imgSize));
													} else {
														const newBoundingBoxes = [...boundingBoxes];
														newBoundingBoxes[index] = newBoundingBox;
														onBoundingBoxChange(clampBoundingBoxes(newBoundingBoxes, imgSize));
													}
												}}
												scale={scale}
												imgSize={imgSize}
												parentSize={contentComponentRect}
											/>
										);
									})
								: null}
						</TransformComponent>
					);
				}}
			</TransformWrapper>
		);
	} else if (isLoading) {
		contents = <p>Loading...</p>;
	} else if (message !== null) {
		contents = <p>{message}</p>;
	}

	return <div className="image-display">{contents}</div>;
}

export default observer(ImageDisplay);

function clampBoundingBox(boundingBox: BoundingBox, imgSize: { width: number; height: number }): BoundingBox {
	const clampedBoundingBox = { ...boundingBox };

	clampedBoundingBox.left = Math.min(Math.max(clampedBoundingBox.left, 0), imgSize.width - 1);
	clampedBoundingBox.top = Math.min(Math.max(clampedBoundingBox.top, 0), imgSize.height - 1);
	clampedBoundingBox.right = Math.min(Math.max(clampedBoundingBox.right, clampedBoundingBox.left), imgSize.width - 1);
	clampedBoundingBox.bottom = Math.min(Math.max(clampedBoundingBox.bottom, clampedBoundingBox.top), imgSize.height - 1);

	return clampedBoundingBox;
}

function clampBoundingBoxes(boundingBoxes: BoundingBox[], imgSize: { width: number; height: number }): BoundingBox[] {
	return boundingBoxes.map((boundingBox) => clampBoundingBox(boundingBox, imgSize));
}

function BoundingBoxAdder({
	onBoundingBoxAdd,
	scale,
	imgSize,
	parentSize,
}: {
	onBoundingBoxAdd: (boundingBox: BoundingBox) => void;
	scale: number;
	imgSize: { width: number; height: number };
	parentSize: { width: number; height: number };
}) {
	const [newBoundingBox, setNewBoundingBox] = useState<BoundingBox | null>(null);

	// Determine how much the image is scaled (it's object-fit: contain)
	const geometry = getImageGeometry(scale, imgSize, parentSize);

	// Now we can convert the bounding box from image coordinates to screen coordinates
	let bbDiv = null;

	if (newBoundingBox !== null) {
		const bbScreenX = geometry.imageX + newBoundingBox.left * geometry.imageScale;
		const bbScreenY = geometry.imageY + newBoundingBox.top * geometry.imageScale;
		const bbScreenWidth = (newBoundingBox.right - newBoundingBox.left + 1) * geometry.imageScale;
		const bbScreenHeight = (newBoundingBox.bottom - newBoundingBox.top + 1) * geometry.imageScale;

		const boxStyle: React.CSSProperties = {
			left: bbScreenX,
			top: bbScreenY,
			width: bbScreenWidth,
			height: bbScreenHeight,
		};

		bbDiv = <div className="bounding-box" style={boxStyle}></div>;
	}

	const handleClick = (event: React.MouseEvent) => {
		if (newBoundingBox === null) {
			return;
		}

		handleContextMenu(event);
	};

	const handleContextMenu = (event: React.MouseEvent) => {
		event.stopPropagation();
		event.preventDefault();

		// Convert the click position to image coordinates
		const { x, y } = clientPointToImagePoint(event.clientX, event.clientY, event.currentTarget, imgSize);

		if (newBoundingBox === null) {
			setNewBoundingBox({ left: x, top: y, right: x, bottom: y, label: "watermark" });
		} else {
			onBoundingBoxAdd(newBoundingBox);
			setNewBoundingBox(null);
		}
	};

	const handleMouseMove = (event: React.MouseEvent) => {
		if (newBoundingBox === null) {
			return;
		}

		// Convert the mouse position to image coordinates
		const { x, y } = clientPointToImagePoint(event.clientX, event.clientY, event.currentTarget, imgSize);

		setNewBoundingBox({
			left: newBoundingBox.left,
			top: newBoundingBox.top,
			right: Math.max(x, newBoundingBox.left),
			bottom: Math.max(y, newBoundingBox.top),
			label: newBoundingBox.label,
		});
	};

	return (
		<div
			style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
			onClick={handleClick}
			onContextMenu={handleContextMenu}
			onMouseMove={handleMouseMove}
		>
			{bbDiv}
		</div>
	);
}

function BoundingBoxOverlay({
	boundingBox,
	onBoundingBoxChange,
	scale,
	imgSize,
	parentSize,
}: {
	boundingBox: BoundingBox;
	onBoundingBoxChange: (boundingBox: BoundingBox | null) => void;
	scale: number;
	imgSize: { width: number; height: number };
	parentSize: { width: number; height: number };
}) {
	const [dragging, setDragging] = useState<{
		clientX: number;
		clientY: number;
		originalBoundingBox: BoundingBox;
		editLeft: boolean;
		editTop: boolean;
		editRight: boolean;
		editBottom: boolean;
	} | null>(null);

	// Determine how much the image is scaled (it's object-fit: contain)
	const geometry = getImageGeometry(scale, imgSize, parentSize);

	// Now we can convert the bounding box from image coordinates to screen coordinates
	const screenX = geometry.imageX + boundingBox.left * geometry.imageScale;
	const screenY = geometry.imageY + boundingBox.top * geometry.imageScale;
	const screenWidth = (boundingBox.right - boundingBox.left + 1) * geometry.imageScale;
	const screenHeight = (boundingBox.bottom - boundingBox.top + 1) * geometry.imageScale;

	const boxStyle: React.CSSProperties = {
		left: screenX,
		top: screenY,
		width: screenWidth,
		height: screenHeight,
		//cursor: dragging ? (dragging.isResizeHandle ? "nwse-resize" : "move") : "auto",
	};

	const handleMouseDown = (
		event: React.MouseEvent,
		editLeft: boolean,
		editTop: boolean,
		editRight: boolean,
		editBottom: boolean,
	) => {
		event.stopPropagation();
		event.preventDefault();

		setDragging({
			clientX: event.clientX,
			clientY: event.clientY,
			originalBoundingBox: boundingBox,
			editLeft,
			editTop,
			editRight,
			editBottom,
		});
	};

	const handleMouseMove = (event: MouseEvent) => {
		if (!dragging) {
			return;
		}
		event.preventDefault();

		// Calculate how far the mouse has moved in image coordinates
		const diffX = (event.clientX - dragging.clientX) / geometry.imageScale / scale;
		const diffY = (event.clientY - dragging.clientY) / geometry.imageScale / scale;
		const originalBB = dragging.originalBoundingBox;

		if (dragging.editBottom && dragging.editRight && dragging.editLeft && dragging.editTop) {
			// Moving the entire bounding box
			const maxX = imgSize.width - (boundingBox.right - boundingBox.left + 1);
			const maxY = imgSize.height - (boundingBox.bottom - boundingBox.top + 1);
			const newLeft = Math.min(Math.max(dragging.originalBoundingBox.left + diffX, 0), maxX);
			const newTop = Math.min(Math.max(dragging.originalBoundingBox.top + diffY, 0), maxY);

			onBoundingBoxChange({
				left: Math.round(newLeft),
				top: Math.round(newTop),
				right: newLeft + originalBB.right - originalBB.left,
				bottom: newTop + originalBB.bottom - originalBB.top,
				label: originalBB.label,
			});
		} else {
			// Resizing the bounding box
			const newLeft = Math.min(Math.max(originalBB.left + diffX, 0), originalBB.right - 1);
			const newRight = Math.min(Math.max(originalBB.right + diffX, originalBB.left), imgSize.width - 1);
			const newTop = Math.min(Math.max(originalBB.top + diffY, 0), originalBB.bottom - 1);
			const newBottom = Math.min(Math.max(originalBB.bottom + diffY, originalBB.top), imgSize.height - 1);

			onBoundingBoxChange({
				left: Math.round(dragging.editLeft ? newLeft : originalBB.left),
				top: Math.round(dragging.editTop ? newTop : originalBB.top),
				right: Math.round(dragging.editRight ? newRight : originalBB.right),
				bottom: Math.round(dragging.editBottom ? newBottom : originalBB.bottom),
				label: originalBB.label,
			});
		}
	};

	const handleMouseUp = () => {
		setDragging(null);
	};

	useEffect(() => {
		if (dragging === null) {
			return;
		}

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [dragging]);

	const handleDelete = () => {
		console.log("delete");
		onBoundingBoxChange(null);
	};

	return (
		<div
			style={boxStyle}
			className="bounding-box"
			onMouseDown={(event) => handleMouseDown(event, true, true, true, true)}
		>
			<div
				style={{
					position: "absolute",
					top: -15,
					left: -15,
					width: 15,
					height: 15,
					backgroundColor: "red",
					color: "white",
					fontWeight: "bold",
					textAlign: "center",
					lineHeight: "15px",
					cursor: "move",
				}}
				onMouseDown={(event) => event.stopPropagation()}
				onClick={handleDelete}
			>
				X
			</div>
			<div
				style={{
					top: -5,
					left: -5,
					cursor: "nwse-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, true, true, false, false)}
			/>
			<div
				style={{
					top: -5,
					left: 5,
					width: "calc(100% - 10px)",
					cursor: "ns-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, false, true, false, false)}
			/>
			<div
				style={{
					top: -5,
					right: -5,
					cursor: "nesw-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, false, true, true, false)}
			/>
			<div
				style={{
					top: 5,
					right: -5,
					height: "calc(100% - 10px)",
					cursor: "ew-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, false, false, true, false)}
			/>
			<div
				style={{
					bottom: -5,
					right: -5,
					cursor: "nwse-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, false, false, true, true)}
			/>
			<div
				style={{
					bottom: -5,
					left: 5,
					width: "calc(100% - 10px)",
					cursor: "ns-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, false, false, false, true)}
			/>
			<div
				style={{
					bottom: -5,
					left: -5,
					cursor: "nesw-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, true, false, false, true)}
			/>
			<div
				style={{
					top: 5,
					left: -5,
					height: "calc(100% - 10px)",
					cursor: "ew-resize",
				}}
				className="resize-handle"
				onMouseDown={(event) => handleMouseDown(event, true, false, false, false)}
			/>
		</div>
	);
}

interface Size {
	width: number;
	height: number;
}

interface ImageGeometry {
	parentWidth: number;
	parentHeight: number;
	imageScale: number;
	imageX: number;
	imageY: number;
}

function getImageGeometry(scale: number, imgSize: Size, parentSize: Size): ImageGeometry {
	const parentWidth = parentSize.width / scale;
	const parentHeight = parentSize.height / scale;
	const imageScale = Math.min(parentWidth / imgSize.width, parentHeight / imgSize.height);
	const imageX = (parentWidth - imgSize.width * imageScale) / 2;
	const imageY = (parentHeight - imgSize.height * imageScale) / 2;

	return {
		parentWidth,
		parentHeight,
		imageScale,
		imageX,
		imageY,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function clientPointToImagePoint(
	clientX: number,
	clientY: number,
	element: Element,
	imgSize: Size,
): { x: number; y: number } {
	const rect = element.getBoundingClientRect();
	const imageScale = Math.min(rect.width / imgSize.width, rect.height / imgSize.height);
	const imageX = (rect.width - imgSize.width * imageScale) / 2;
	const imageY = (rect.height - imgSize.height * imageScale) / 2;

	const x = (clientX - rect.left - imageX) / imageScale;
	const y = (clientY - rect.top - imageY) / imageScale;

	return {
		x: clamp(x, 0, imgSize.width - 1),
		y: clamp(y, 0, imgSize.height - 1),
	};
}
