// Popup.tsx
import React from "react";

interface PopupProps {
	onClose: () => void;
	title: string;
	children: React.ReactNode;
	className?: string;
	onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
	onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
}

function Popup({ onClose, title, children, className, onDragOver, onDrop }: PopupProps) {
	function onBackgroundClicked(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	return (
		<div className="popup-background" onClick={onBackgroundClicked}>
			<div className={"popup-window " + (className ?? "")} onDragOver={onDragOver} onDrop={onDrop}>
				<div className="popup-window-content">
					<div className="popup-window-header">
						<div className="popup-window-title">{title}</div>
						<div className="popup-window-close" onClick={onClose}>
							&times;
						</div>
					</div>
					<div className="popup-window-body">{children}</div>
				</div>
			</div>
		</div>
	);
}

export default Popup;
