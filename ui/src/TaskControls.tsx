import { Icon } from "@iconify-icon/react";

interface TaskControlsProps {
	taskCounts?: {
		waiting?: number;
		in_progress?: number;
		done?: number;
	};
	onBackClicked: () => void;
	onForwardClicked: () => void;
	onFinishedClicked: () => void;
	canGoBack: boolean;
	canGoForward: boolean;
	canFinish: boolean;
}

function TaskControls({
	taskCounts,
	onBackClicked,
	onForwardClicked,
	onFinishedClicked,
	canGoBack,
	canGoForward,
	canFinish,
}: TaskControlsProps) {
	const totalTasks = (taskCounts?.waiting ?? 0) + (taskCounts?.in_progress ?? 0) + (taskCounts?.done ?? 0);
	const doneTasks = taskCounts?.done ?? 0;
	//const remainingTasks = totalTasks - doneTasks;
	// Avoid division by zero
	const donePercent = totalTasks === 0 ? 0 : (doneTasks / totalTasks) * 100;
	//const remainingPercent = totalTasks === 0 ? 100 : (remainingTasks / totalTasks) * 100;

	return (
		<div className="task-controls row">
			<div className="left-side column contentBased">
				<div className="task-progress-bar">
					<div className="task-progress-segment done" style={{ width: `${donePercent}%` }}></div>
					<div className="task-counts-tooltip">
						{doneTasks} / {totalTasks} tasks
					</div>
				</div>
			</div>
			<div className="center column remainingSpace"></div>
			<div className="right-side row contentBased">
				<div className="control">
					<button
						className="control-button task-nav-button"
						onClick={onBackClicked}
						title="Previous task"
						disabled={!canGoBack}
					>
						<Icon icon="fluent:chevron-left-24-filled" className="icon" width="24" />
					</button>
				</div>
				<div className="control">
					<button
						className="control-button task-nav-button"
						onClick={onForwardClicked}
						title="Next task"
						disabled={!canGoForward}
					>
						<Icon icon="fluent:chevron-right-24-filled" className="icon" width="24" />
					</button>
				</div>
				<div className="control task-finish-control">
					<button className="control-button" onClick={onFinishedClicked} disabled={!canFinish}>
						Finished
					</button>
				</div>
			</div>
		</div>
	);
}

export default TaskControls;
