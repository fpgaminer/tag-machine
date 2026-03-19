import { makeAutoObservable, runInAction } from "mobx";
import * as api from "../api";
import { errorMessageState } from "../state";
import { imageListState } from "./ImageList";

interface TaskData {
	image_id: number;
	noun_phrase: string;
}

export interface VQATaskEntry {
	task: api.ApiTask;
	data: TaskData;
	isFinished: boolean;
}

const VQA_TASK_GROUP = "vqa-needs-prompts";

class VQATaskQueueState {
	tasks: VQATaskEntry[] = [];
	currentIndex: number | null = null;
	taskCounts: Record<string, number> = {};
	isInitializing = false;
	isLoadingNextTask = false;
	isFinishingCurrentTask = false;
	hasInitialized = false;

	constructor() {
		makeAutoObservable(this, {}, { autoBind: true });
	}

	get currentTask(): VQATaskEntry | null {
		if (this.currentIndex === null) {
			return null;
		}

		return this.tasks[this.currentIndex] ?? null;
	}

	get currentImageId(): number | null {
		return this.currentTask?.data.image_id ?? null;
	}

	get canGoBack(): boolean {
		if (this.tasks.length === 0) {
			return false;
		}

		if (this.currentIndex === null) {
			return true;
		}

		return this.currentIndex > 0;
	}

	get canFinishCurrentTask(): boolean {
		return this.currentTask !== null && !this.currentTask.isFinished && !this.isFinishingCurrentTask;
	}

	async initialize() {
		if (this.hasInitialized || this.isInitializing) {
			return;
		}

		runInAction(() => {
			this.isInitializing = true;
		});

		try {
			await this.goForward();
			runInAction(() => {
				this.hasInitialized = true;
			});
		} finally {
			runInAction(() => {
				this.isInitializing = false;
			});
		}
	}

	async refreshTaskCounts() {
		try {
			const counts = await api.countTasks(VQA_TASK_GROUP);
			runInAction(() => {
				this.taskCounts = counts;
			});
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to fetch VQA task counts: ${String(error)}`);
		}
	}

	goBack() {
		if (!this.canGoBack || this.isLoadingNextTask || this.isFinishingCurrentTask) {
			return;
		}

		runInAction(() => {
			if (this.currentIndex === null) {
				this.currentIndex = this.tasks.length - 1;
				return;
			}

			this.currentIndex -= 1;
		});
	}

	async goForward() {
		if (this.isLoadingNextTask || this.isFinishingCurrentTask) {
			return;
		}

		if (this.currentIndex !== null && this.currentIndex < this.tasks.length - 1) {
			const nextIndex = this.currentIndex + 1;
			runInAction(() => {
				this.currentIndex = nextIndex;
			});
			return;
		}

		await this.acquireNextTask();
	}

	async finishCurrentTask() {
		const currentTask = this.currentTask;

		if (currentTask === null || currentTask.isFinished || this.isFinishingCurrentTask) {
			return;
		}

		runInAction(() => {
			this.isFinishingCurrentTask = true;
		});

		try {
			await api.finishTask(currentTask.task.id);

			runInAction(() => {
				currentTask.isFinished = true;
			});

			await this.refreshTaskCounts();

			if (this.currentIndex !== null && this.currentIndex < this.tasks.length - 1) {
				const nextIndex = this.currentIndex + 1;
				runInAction(() => {
					this.currentIndex = nextIndex;
				});
			} else {
				await this.acquireNextTask(true);
			}
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to finish VQA task: ${String(error)}`);
		} finally {
			runInAction(() => {
				this.isFinishingCurrentTask = false;
			});
		}
	}

	private async acquireNextTask(refreshCounts = true) {
		runInAction(() => {
			this.isLoadingNextTask = true;
		});

		try {
			const nextTask = await acquireTask();

			runInAction(() => {
				if (nextTask === null) {
					this.currentIndex = null;
					return;
				}

				this.tasks.push(nextTask);
				this.currentIndex = this.tasks.length - 1;
			});

			if (refreshCounts) {
				await this.refreshTaskCounts();
			}
		} catch (error) {
			errorMessageState.setErrorMessage(`Failed to acquire VQA task: ${String(error)}`);
		} finally {
			runInAction(() => {
				this.isLoadingNextTask = false;
			});
		}
	}
}

export const vqaTaskQueueState = new VQATaskQueueState();

async function acquireTask(): Promise<VQATaskEntry | null> {
	const task = await api.acquireTask(VQA_TASK_GROUP);

	if (task === null) {
		return null;
	}

	const data = JSON.parse(task.data) as TaskData;
	await imageListState.fetchImage(data.image_id);

	return {
		task,
		data,
		isFinished: task.status === "done",
	};
}
