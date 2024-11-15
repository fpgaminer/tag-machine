import { ImageObject, imageHashToUrl, imageInfoPopupState } from "./state";
import { observer } from "mobx-react";
import exifr from "exifr";
import React from "react";
import { authState } from "./state/Auth";
import { authenticatedFetch } from "./api";

async function uploadToImgOps(imageHash: string, token: string | null) {
	if (token === null) {
		return;
	}

	const response = await authenticatedFetch(`/api/images/${imageHash}/imgops`, { method: "POST" });
	if (!response.ok) {
		alert(`Failed to fetch image: ${response.statusText} (${response.status})`);
		return;
	}

	const redirectUrl = await response.text();

	window.open(`https://imgops.com${redirectUrl}`, "_blank");
}

async function getExifData(url: string, token: string): Promise<string> {
	try {
		const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
		const blob = await response.blob();
		const exifData = await exifr.parse(blob);

		if (!exifData) {
			return "No EXIF data found";
		}

		//const formattedData = Object.entries(exifData)
		//	.map(([key, value]) => `${key}: ${value}`)
		//	.join("\n");
		const formattedData = formatExifData(exifData);
		
		return formattedData;
	} catch (e) {
		return `Error fetching EXIF data: ${e}`;
	}
}

function formatExifData(exifData: Record<string, any>): string {
	const result = [
		exifData.Make ? `Make: ${exifData.Make}` : null,
		exifData.Model ? `Model: ${exifData.Model}` : null,
		exifData.LensModel ? `Lens: ${exifData.LensModel}` : null,
		exifData.FocalLength ? `Focal Length: ${exifData.FocalLength} mm` : null,
		exifData.FNumber ? `Aperture: f/${exifData.FNumber}` : null,
		exifData.ExposureTime ? `Exposure: 1/${Math.round(1 / exifData.ExposureTime)}s` : null,
		exifData.ISO ? `ISO: ${exifData.ISO}` : null,
		exifData.Flash ? `Flash: ${exifData.Flash}` : null,
	];

	return result.filter((x) => x !== null).join("\n");
}

interface ImageInfoPopupProps {
	image: ImageObject;
}

function ImageInfoPopup(props: ImageInfoPopupProps) {
	const { image } = props;
	const url = imageHashToUrl(image.hash);
	const [exifData, setExifData] = React.useState<string | null>(null);
	const userToken = authState.user_token;

	React.useEffect(() => {
		if (userToken !== null) {
			void getExifData(url, userToken).then(setExifData);
		}
	}, [url]);

	function onBackgroundClicked(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		if (e.target === e.currentTarget) {
			imageInfoPopupState.setImageInfoPopupVisible(false);
		}
	}

	function toLink(name: string, value: string | string[]): JSX.Element {
		if (name == "danbooru_post_id") {
			return <a href={`https://danbooru.donmai.us/posts/${value}`} target="_blank" rel="noreferrer">{value}</a>;
		}
		else if (name == "e621_post_id") {
			return <a href={`https://e621.net/posts/${value}`} target="_blank" rel="noreferrer">{value}</a>;
		}

		return <span>{value}</span>;
	}

	const attributes = Array.from(image.flatAttributes.entries()).map(([name, value]) => {
		return (
			<div className="image-info-attribute" key={name}>
				<div className="image-info-attribute-name">{name}</div>
				<div className="image-info-attribute-value">{toLink(name, value)}</div>
			</div>
		);
	});

	const exif = exifData ? <pre>{exifData}</pre> : <p>Loading EXIF data...</p>;

	return (
		<div className="popup-background" onClick={onBackgroundClicked}>
			<div className="image-info-popup">
				<div className="image-info-popup-content">
					<div className="image-info-popup-header">
						<div className="image-info-popup-title">{image.hash}</div>
						<div className="image-info-popup-close" onClick={() => imageInfoPopupState.setImageInfoPopupVisible(false)}>
							X
						</div>
					</div>
					<div className="image-info-popup-body">
						<div className="image-info-popup-body-content">
							<div className="image-info-attributes">
								{attributes}
								<div className="image-info-attribute">
									<div className="image-info-attribute-name">EXIF</div>
									<div className="image-info-attribute-value">{exif}</div>
								</div>
								<div className="image-info-attribute">
									<div className="image-info-attribute-name">ImgOps</div>
									<div className="image-info-attribute-value">
										<button onClick={() => uploadToImgOps(image.hash, userToken)}>Upload to ImgOps</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default observer(ImageInfoPopup);
