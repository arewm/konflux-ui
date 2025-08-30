import { createMatrixInstanceLabel } from '../components/PipelineRun/PipelineRunDetailsView/visualization/utils/pipelinerun-graph-utils';
import { PipelineTask, TaskRunKind, PipelineRunKind , TektonResourceLabel } from '../types';

export interface TaskDisplayInfo {
  /** The base task name */
  taskName: string;
  /** Additional info (matrix representation or displayName) */
  additionalInfo?: string;
  /** Full display string combining task name and additional info */
  displayString: string;
}

/**
 * Generates consistent task display information for both matrix and regular tasks.
 * This function replicates the logic used in the logs page to ensure consistency.
 * 
 * @param task - The pipeline task definition
 * @param taskRun - The specific task run instance
 * @param pipelineRun - The pipeline run containing the task
 * @param allTaskRuns - All task runs for the pipeline run
 * @returns TaskDisplayInfo with consistent naming
 */
export const getTaskDisplayInfo = (
  task: PipelineTask,
  taskRun: TaskRunKind,
  pipelineRun: PipelineRunKind,
  allTaskRuns: TaskRunKind[]
): TaskDisplayInfo => {
  const taskName = task.name;
  let additionalInfo: string | undefined;

  // Check if this is a matrix task by looking for multiple TaskRuns with the same pipeline task name
  const matrixTaskRuns = allTaskRuns.filter(tr => 
    tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === taskName
  );
  const isMatrixTask = matrixTaskRuns.length > 1;

  if (isMatrixTask) {
    // Matrix task: generate matrix label using the same logic as the logs page
    const instanceIndex = matrixTaskRuns.findIndex(tr => tr.metadata.name === taskRun.metadata.name);
    if (instanceIndex >= 0) {
      additionalInfo = createMatrixInstanceLabel(task, taskRun, pipelineRun, instanceIndex);
    }
  } else {
    // Regular task: check for displayName in childReferences
    const childReferences = pipelineRun.status?.childReferences;
    const childRef = (childReferences as Array<{ name: string; displayName?: string }>)?.find(
      (ref) => ref.name === taskRun.metadata.name,
    );
    if (childRef?.displayName) {
      additionalInfo = childRef.displayName;
    }
  }

  // Generate the full display string
  const displayString = additionalInfo 
    ? `${taskName} (${additionalInfo})`
    : taskName;

  return {
    taskName,
    additionalInfo,
    displayString,
  };
};
