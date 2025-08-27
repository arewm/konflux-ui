import { PipelineNodeModel as PfPipelineNodeModel, WhenStatus } from '@patternfly/react-topology';
import { ScanResults } from '../../../../hooks/useScanResults';
import { PipelineTask, TaskRunKind, TaskRunStatus } from '../../../../types';
import { runStatus } from '../../../../utils/pipeline-utils';

export enum PipelineRunNodeType {
  SPACER_NODE = 'spacer-node',
  FINALLY_NODE = 'finally-node',
  FINALLY_GROUP = 'finally-group',
  TASK_NODE = 'pipelinerun-task-node',
  EDGE = 'pipelinerun-edge',
}

export type StepStatus = {
  name: string;
  startTime?: string | number;
  endTime?: string | number;
  status: runStatus;
};

export type PipelineRunNodeData = {
  task: PipelineTask;
  status?: runStatus;
  namespace: string;
  testFailCount?: number;
  testWarnCount?: number;
  scanResults?: ScanResults;
  whenStatus?: WhenStatus;
  steps?: StepStatus[];
  taskRun?: TaskRunKind;
};

export type PipelineTaskStatus = TaskRunStatus & {
  reason: runStatus;
  duration?: string;
  testFailCount?: number;
  testWarnCount?: number;
  scanResults?: ScanResults;
};

export type PipelineTaskWithStatus = PipelineTask & {
  status: PipelineTaskStatus;
  steps?: StepStatus[];
};

/**
 * Enhanced matrix task type with generic matrix parameter support
 */
export type MatrixPipelineTaskWithStatus = PipelineTaskWithStatus & {
  /** Original task name before matrix expansion */
  originalName?: string;
  /** Matrix parameter name (e.g., 'TARGET_PLATFORM', 'NODE_VERSION') */
  matrixParameter?: string;
  /** Matrix parameter value (e.g., 'linux-x86_64', '18.x') */
  matrixValue?: string;
  /** Human-readable display name for the matrix parameter */
  matrixDisplayName?: string;
  /** Whether this task is part of a matrix */
  isMatrix?: boolean;
  /** Legacy field for TARGET_PLATFORM compatibility */
  matrixPlatform?: string;
  /** All matrix parameters for this task instance */
  matrixParameters?: Array<{
    parameter: string;
    value: string;
    displayName: string;
    isKnownParameter: boolean;
  }>;
};

export type PipelineRunNodeModel<D extends PipelineRunNodeData, T> = Omit<
  PfPipelineNodeModel,
  'type'
> & {
  data: D;
  type: T;
};
