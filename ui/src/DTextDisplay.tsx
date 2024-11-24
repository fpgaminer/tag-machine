import { tagListState } from "./state/TagList";
import { wikiPopupState } from "./WikiPopup";

export interface DTextTag {
	type: string;
	content: string;
	arg: string | null;
}

export interface DTextDisplayProps {
	dtext: DTextTag[];
}

export default function DTextDisplay(props: DTextDisplayProps) {
	const { dtext } = props;

	function handleLinkClick(arg: string, event: React.MouseEvent<HTMLAnchorElement>) {
		event.preventDefault();

		// all lowercase, replace spaces with underscores
		const tagName = arg.toLowerCase().replace(" ", "_");
		const tag = tagListState.getTagByName(tagName);

		if (tag === null) {
			return null;
		}

		wikiPopupState.setTag(tag);
		return null;
	}

	const elements = dtext.map((tag, index) => {
		switch (tag.type) {
			case "bold":
				return <b key={index}>{tag.content}</b>;
			case "italic":
				return <i key={index}>{tag.content}</i>;
			case "link":
				if (tag.arg === null) {
					return (
						<a key={index} onClick={(event) => event.preventDefault()} href="#">
							{tag.content}
						</a>
					);
				} else {
					return (
						<a key={index} onClick={(event) => handleLinkClick(tag.arg as string, event)} href={`#${tag.arg}`}>
							{tag.content}
						</a>
					);
				}
			case "header":
				switch (tag.arg) {
					case "1":
						return <h1 key={index}>{tag.content}</h1>;
					case "2":
						return <h2 key={index}>{tag.content}</h2>;
					case "3":
						return <h3 key={index}>{tag.content}</h3>;
					case "4":
						return <h4 key={index}>{tag.content}</h4>;
					case "5":
						return <h5 key={index}>{tag.content}</h5>;
					case "6":
						return <h6 key={index}>{tag.content}</h6>;
					default:
						return <h1 key={index}>{tag.content}</h1>;
				}
			case "br":
				return <br key={index} />;
			case "text":
				return <span key={index}>{tag.content}</span>;
			default:
				return <span key={index}>{tag.content}</span>;
		}
	});

	return <div className="dtext-display">{elements}</div>;
}
