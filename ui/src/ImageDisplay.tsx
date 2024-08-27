import { observer } from "mobx-react";
import { imageHashToUrl, imageResolutionState } from "./state";
import { currentImageState } from "./state/CurrentImage";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import React from "react";

function ImageDisplay() {
	const currentImage = currentImageState.image;
	let contents = <p>Loading...</p>;

	if (currentImage !== null) {
		let url = imageHashToUrl(currentImage.hash);

		if (imageResolutionState.resolution !== null) {
			url += `?size=${imageResolutionState.resolution}`;
		}

		contents = (
			<TransformWrapper initialScale={1} initialPositionX={0} initialPositionY={0} limitToBounds={true}>
				{({ zoomIn, zoomOut, resetTransform, ...rest }) => (
					<React.Fragment>
						<TransformComponent>
							<img src={url} alt={currentImage.hash} />
						</TransformComponent>
					</React.Fragment>
				)}
			</TransformWrapper>
		);
	}

	return <div className="image-display">{contents}</div>;
}

export default observer(ImageDisplay);
