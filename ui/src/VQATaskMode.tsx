import { observer } from "mobx-react";
import ActiveTagList from "./ActiveTagList";
import ImageDisplay from "./ImageDisplay";
import VQAEditor from "./VQAEditor";
import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import TaskControls from "./TaskControls";
import { imageListState } from "./state/ImageList";
import { imageResolutionState } from "./state";

interface TaskData {
	image_id: number;
	noun_phrase: string;
}

interface CurrentTask {
	task: api.ApiTask;
	data: TaskData;
}

function VQATaskMode() {
	const initialHeight = parseFloat(localStorage.getItem("layout-vqamode-height") ?? "50");
	const [activeTagListHeight, setActiveTagListHeight] = useState(initialHeight);
	const isResizing = useRef(false);
	const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
	const [currentTask, setCurrentTask] = useState<CurrentTask | null>(null);
	const currentImage = currentTask !== null ? imageListState.getImageById(currentTask.data.image_id) : null;
	const currentImageQA = currentImage !== null ? currentImage.singularAttribute("questionAnswer") : null;

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

	async function fetchTaskCount() {
		const taskCounts = await api.countTasks("vqa-needs-prompts");
		setTaskCounts(taskCounts);
	}

	async function acquireTask() {
		const task = await api.acquireTask("vqa-needs-prompts");

		if (task === null) {
			setCurrentTask(null);
			return;
		}

		// Parse task data
		const data = JSON.parse(task.data) as TaskData;

		// Fetch the image into our cache
		await imageListState.fetchImage(data.image_id);

		// Set the current task
		setCurrentTask({ task, data });

		// Update task counts
		void fetchTaskCount();
	}

	async function onFinishedClicked() {
		if (currentTask === null) {
			return;
		}

		await api.finishTask(currentTask.task.id);

		setCurrentTask(null);
		void acquireTask();
	}

	function onSkipClicked() {
		setCurrentTask(null);
		void acquireTask();
	}

	// Acquire a task on load
	useEffect(() => {
		void acquireTask();
	}, []);

	const containerRef = useRef<HTMLDivElement>(null);

	return (
		<div className="row remainingSpace" ref={containerRef}>
			<div className="column remainingSpace spacing-5">
				<div className="row remainingSpace">
					<ImageDisplay
						imageId={currentImage !== null ? currentImage.id : null}
						resolution={imageResolutionState.resolution}
						message={"No tasks left"}
					/>
				</div>
				<div className="row contentBased">
					<TaskControls taskCounts={taskCounts} onFinishedClicked={onFinishedClicked} onSkipClicked={onSkipClicked} />
				</div>
			</div>
			<div className="column sideColumnLarge spacing-5">
				<div className="resizable-panel" style={{ flex: `0 0 ${activeTagListHeight}%` }}>
					<ActiveTagList readonly={true} />
				</div>
				<div className="divider horizontal-divider" onMouseDown={onMouseDown} />
				<div className="resizable-panel" style={{ flex: 1 }}>
					{currentTask !== null ? <VQAEditor imageId={currentTask.data.image_id} imageQA={currentImageQA} /> : null}
				</div>
			</div>
		</div>
	);
}

export default observer(VQATaskMode);
