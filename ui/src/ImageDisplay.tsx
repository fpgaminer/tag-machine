import { observer } from "mobx-react";
import { errorMessageState, imageIdToUrl } from "./state";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import React, { useEffect, useState } from "react";
import { authState } from "./state/Auth";
import { currentImageState } from "./state/CurrentImage";

function ImageDisplay({
	imageId,
	resolution,
	message,
}: {
	imageId: number | null;
	resolution: number | null;
	message: React.ReactNode | null;
}) {
	const [imageData, setImageData] = useState<string | null>(null);
	const userToken = authState.user_token;

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

	let contents = <p>Loading...</p>;

	if (imageData !== null) {
		contents = (
			<TransformWrapper initialScale={1} initialPositionX={0} initialPositionY={0} limitToBounds={true}>
				{({ zoomIn, zoomOut, resetTransform, ...rest }) => (
					<React.Fragment>
						<TransformComponent>
							<img src={imageData} />
						</TransformComponent>
					</React.Fragment>
				)}
			</TransformWrapper>
		);
	} else if (message !== null) {
		contents = <p>{message}</p>;
	}

	return <div className="image-display">{contents}</div>;
}

export default observer(ImageDisplay);
