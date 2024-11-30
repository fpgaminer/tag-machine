import { ImageObject, PopupStates, imageHashToUrl, popupsState } from "./state";
import { observer } from "mobx-react";
import exifr from "exifr";
import React from "react";
import { authState } from "./state/Auth";
import { authenticatedFetch } from "./api";
import Popup from "./Popup";
import { makeAutoObservable } from "mobx";

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
		const exifData = (await exifr.parse(blob)) as Record<string, string | number> | undefined;

		if (!exifData) {
			return "No EXIF data found";
		}

		//const formattedData = Object.entries(exifData)
		//	.map(([key, value]) => `${key}: ${value}`)
		//	.join("\n");
		const formattedData = formatExifData(exifData);

		return formattedData;
	} catch (e) {
		return `Error fetching EXIF data: ${String(e)}`;
	}
}

function formatExifData(exifData: Record<string, string | number>): string {
	const result = [
		exifData.Make ? `Make: ${exifData.Make}` : null,
		exifData.Model ? `Model: ${exifData.Model}` : null,
		exifData.LensModel ? `Lens: ${exifData.LensModel}` : null,
		exifData.FocalLength ? `Focal Length: ${exifData.FocalLength} mm` : null,
		exifData.FNumber ? `Aperture: f/${exifData.FNumber}` : null,
		exifData.ExposureTime ? `Exposure: 1/${Math.round(1 / (exifData.ExposureTime as number))}s` : null,
		exifData.ISO ? `ISO: ${exifData.ISO}` : null,
		exifData.Flash ? `Flash: ${exifData.Flash}` : null,
	];

	return result.filter((x) => x !== null).join("\n");
}

export const ImageInfoPopup = observer(function ImageInfoPopupComponent() {
	const image = imageInfoPopupState.image;
	const url = image !== null ? imageHashToUrl(image.hash) : null;
	const [exifData, setExifData] = React.useState<string | null>(null);
	const userToken = authState.user_token;

	React.useEffect(() => {
		if (userToken !== null && url !== null) {
			void getExifData(url, userToken).then(setExifData);
		}
	}, [url, userToken]);

	function toLink(name: string, value: string | string[]): JSX.Element {
		if (value instanceof Array && value.length != 1) {
			return <span>{value}</span>;
		} else if (value instanceof Array) {
			value = value[0];
		}

		if (name == "danbooru_post_id") {
			return (
				<a href={`https://danbooru.donmai.us/posts/${value}`} target="_blank" rel="noreferrer">
					{value}
				</a>
			);
		} else if (name == "e621_post_id") {
			return (
				<a href={`https://e621.net/posts/${value}`} target="_blank" rel="noreferrer">
					{value}
				</a>
			);
		}

		return <span>{value}</span>;
	}

	if (image === null) {
		return null;
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
		<Popup
			onClose={() => popupsState.removePopup(PopupStates.ImageInfo)}
			title={image.hash}
			className="image-info-popup"
		>
			<div className="image-info-popup-body-content">
				<div className="image-info-attributes">
					<div className="image-info-attribute">
						<div className="image-info-attribute-name">Image ID</div>
						<div className="image-info-attribute-value">{image.id}</div>
					</div>
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
		</Popup>
	);
});

export const imageInfoPopupState = makeAutoObservable({
	image: null as ImageObject | null,
	setImage(image: ImageObject | null) {
		this.image = image;
	},
});
