interface TaskControlsProps {
	taskCounts?: {
		waiting?: number;
		in_progress?: number;
		done?: number;
	};
	onFinishedClicked: () => void;
	onSkipClicked: () => void;
}

function TaskControls({ taskCounts, onFinishedClicked, onSkipClicked }: TaskControlsProps) {
	const totalTasks = (taskCounts?.waiting ?? 0) + (taskCounts?.in_progress ?? 0) + (taskCounts?.done ?? 0);
	const doneTasks = taskCounts?.done ?? 0;
	const remainingTasks = totalTasks - doneTasks;
	// Avoid division by zero
	const donePercent = totalTasks === 0 ? 0 : (doneTasks / totalTasks) * 100;
	const remainingPercent = totalTasks === 0 ? 100 : (remainingTasks / totalTasks) * 100;

	return (
		<div className="task-controls row">
			<div className="left-side column contentBased">
				<div className="task-progress-bar">
					<div className="task-progress-segment done" style={{ width: `${donePercent}%` }}></div>
					<div className="task-progress-segment waiting" style={{ width: `${remainingPercent}%` }}></div>
					<div className="task-counts-tooltip">
						{doneTasks} / {totalTasks} tasks
					</div>
				</div>
			</div>
			<div className="center column remainingSpace"></div>
			<div className="right-side row contentBased">
				<div className="control">
					<button className="control-button" onClick={onSkipClicked}>
						Skip
					</button>
				</div>
				<div className="control">
					<button className="control-button" onClick={onFinishedClicked}>
						Finished
					</button>
				</div>
			</div>
		</div>
	);
}

export default TaskControls;
