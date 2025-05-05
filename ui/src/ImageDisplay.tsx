import { observer } from "mobx-react";
import { errorMessageState, imageIdToUrl } from "./state";
import { ReactZoomPanPinchRef, TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import React, { useEffect, useRef, useState } from "react";
import { authState } from "./state/Auth";
import { currentImageState } from "./state/CurrentImage";

// Inclusive bounding box.
// The smallest box is when left == right (or top == bottom), which is a width/height of 1.
export interface BoundingBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
	label: string;
}

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
	const userToken = authState.user_token;
	const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
	const transformRef = useRef<ReactZoomPanPinchRef>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const imageRef = useRef<HTMLImageElement>(null);

	const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
		const { naturalWidth, naturalHeight } = e.currentTarget;
		setImgSize({ width: naturalWidth, height: naturalHeight });
		transformRef.current?.resetTransform();
	};

	useEffect(() => {
		if (userToken !== null && imageId !== null) {
			let url = imageIdToUrl(imageId);

			if (resolution !== null) {
				url += `?size=${resolution}`;
			}

			fetch(url, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${userToken}`,
				},
			})
				.then((response) => {
					if (!response.ok) {
						throw new Error(`Failed to fetch image: ${response.statusText}`);
					}

					return response.blob();
				})
				.then((blob) => {
					setImageData(URL.createObjectURL(blob));
				})
				.catch((error) => {
					errorMessageState.setErrorMessage(`Error fetching image: ${error}`);
				});
		} else {
			setImageData(null);
		}

		currentImageState.displayedImageId = imageId;
	}, [imageId, userToken, resolution]);

	const handleBoundingBoxAdd = (boundingBox: BoundingBox) => {
		if (!onBoundingBoxChange || !imgSize) {
			return;
		}

		onBoundingBoxChange(clampBoundingBoxes([...(boundingBoxes ?? []), boundingBox], imgSize));
	};

	let contents = <p>Loading...</p>;

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
					const { positionX, positionY, scale } = utils.instance.transformState;
					const contentComponentRect = utils.instance.contentComponent?.getBoundingClientRect();

					return (
						<TransformComponent>
							<img src={imageData} onLoad={handleImageLoad} ref={imageRef} />
							{enableBoundingBoxes && onBoundingBoxChange && imgSize && contentComponentRect ? (
								<BoundingBoxAdder
									onBoundingBoxAdd={handleBoundingBoxAdd}
									scale={scale}
									imgSize={imgSize}
									parentSize={contentComponentRect}
									positionX={positionX}
									positionY={positionY}
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
	} else if (message !== null) {
		contents = <p>{message}</p>;
	}

	return (
		<div className="image-display" ref={containerRef}>
			{contents}
		</div>
	);
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
	positionX,
	positionY,
}: {
	onBoundingBoxAdd: (boundingBox: BoundingBox) => void;
	scale: number;
	imgSize: { width: number; height: number };
	parentSize: { width: number; height: number };
	positionX: number;
	positionY: number;
}) {
	const [newBoundingBox, setNewBoundingBox] = useState<BoundingBox | null>(null);

	// Determine how much the image is scaled (it's object-fit: contain)
	const parentWidth = parentSize.width / scale;
	const parentHeight = parentSize.height / scale;
	const imageScale = Math.min(parentWidth / imgSize.width, parentHeight / imgSize.height);

	// The image is always centered in the parent container, so we can calculate the position of the image in screen coordinates
	const imageX = (parentWidth - imgSize.width * imageScale) / 2;
	const imageY = (parentHeight - imgSize.height * imageScale) / 2;

	// Now we can convert the bounding box from image coordinates to screen coordinates
	let bbDiv = null;

	if (newBoundingBox !== null) {
		const bbScreenX = imageX + newBoundingBox.left * imageScale;
		const bbScreenY = imageY + newBoundingBox.top * imageScale;
		const bbScreenWidth = (newBoundingBox.right - newBoundingBox.left + 1) * imageScale;
		const bbScreenHeight = (newBoundingBox.bottom - newBoundingBox.top + 1) * imageScale;

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
		const rect = event.currentTarget.getBoundingClientRect();
		const rectImageScale = Math.min(rect.width / imgSize.width, rect.height / imgSize.height);
		const rectImageX = (rect.width - imgSize.width * rectImageScale) / 2;
		const rectImageY = (rect.height - imgSize.height * rectImageScale) / 2;
		const x = (event.clientX - rect.left - rectImageX) / rectImageScale;
		const y = (event.clientY - rect.top - rectImageY) / rectImageScale;
		const clampedX = Math.min(Math.max(x, 0), imgSize.width - 1);
		const clampedY = Math.min(Math.max(y, 0), imgSize.height - 1);
		//console.log("clientX", event.clientX, "clientY", event.clientY, "rect", rect, "rectImageScale", rectImageScale, "rectImageX", rectImageX, "rectImageY", rectImageY, "x", x, "y", y);

		if (newBoundingBox === null) {
			setNewBoundingBox({ left: clampedX, top: clampedY, right: clampedX, bottom: clampedY, label: "watermark" });
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
		const rect = event.currentTarget.getBoundingClientRect();
		const rectImageScale = Math.min(rect.width / imgSize.width, rect.height / imgSize.height);
		const rectImageX = (rect.width - imgSize.width * rectImageScale) / 2;
		const rectImageY = (rect.height - imgSize.height * rectImageScale) / 2;
		const x = (event.clientX - rect.left - rectImageX) / rectImageScale;
		const y = (event.clientY - rect.top - rectImageY) / rectImageScale;
		const clampedX = Math.min(Math.max(x, 0), imgSize.width - 1);
		const clampedY = Math.min(Math.max(y, 0), imgSize.height - 1);

		setNewBoundingBox({
			left: newBoundingBox.left,
			top: newBoundingBox.top,
			right: Math.max(clampedX, newBoundingBox.left),
			bottom: Math.max(clampedY, newBoundingBox.top),
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
	const parentWidth = parentSize.width / scale;
	const parentHeight = parentSize.height / scale;
	const imageScale = Math.min(parentWidth / imgSize.width, parentHeight / imgSize.height);

	// The image is always centered in the parent container, so we can calculate the position of the image in screen coordinates
	const imageX = (parentWidth - imgSize.width * imageScale) / 2;
	const imageY = (parentHeight - imgSize.height * imageScale) / 2;

	// Now we can convert the bounding box from image coordinates to screen coordinates
	const screenX = imageX + boundingBox.left * imageScale;
	const screenY = imageY + boundingBox.top * imageScale;
	const screenWidth = (boundingBox.right - boundingBox.left + 1) * imageScale;
	const screenHeight = (boundingBox.bottom - boundingBox.top + 1) * imageScale;

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
		const diffX = (event.clientX - dragging.clientX) / imageScale / scale;
		const diffY = (event.clientY - dragging.clientY) / imageScale / scale;
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
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	});

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
