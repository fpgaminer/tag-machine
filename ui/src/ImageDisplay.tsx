import { observer } from "mobx-react";
import { errorMessageState, imageHashToUrl, imageResolutionState } from "./state";
import { currentImageState } from "./state/CurrentImage";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import React, { useEffect, useState } from "react";

function ImageDisplay() {
	const [imageData, setImageData] = useState<string | null>(null);
	const currentImage = currentImageState.image;
	const userToken = localStorage.getItem("user_token");

	useEffect(() => {
		if (currentImage !== null && userToken !== null) {
			let url = imageHashToUrl(currentImage.hash);

			if (imageResolutionState.resolution !== null) {
				url += `?size=${imageResolutionState.resolution}`;
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
		}
	}, [currentImage, userToken]);

	let contents = <p>Loading...</p>;

	if (imageData !== null && currentImage !== null) {
		//let url = imageHashToUrl(currentImage.hash);

		//if (imageResolutionState.resolution !== null) {
		//	url += `?size=${imageResolutionState.resolution}`;
		//}

		contents = (
			<TransformWrapper initialScale={1} initialPositionX={0} initialPositionY={0} limitToBounds={true}>
				{({ zoomIn, zoomOut, resetTransform, ...rest }) => (
					<React.Fragment>
						<TransformComponent>
							<img src={imageData} alt={currentImage.hash} />
						</TransformComponent>
					</React.Fragment>
				)}
			</TransformWrapper>
		);
	}

	return <div className="image-display">{contents}</div>;
}

export default observer(ImageDisplay);
