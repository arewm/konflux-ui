import { TaskRunKind, TektonResourceLabel } from '../types';

/**
 * Matrix task detection result
 */
export interface MatrixTaskInfo {
  /** Original task name */
  taskName: string;
  /** Whether this task has multiple matrix instances */
  isMatrix: boolean;
  /** Total number of matrix instances */
  instanceCount: number;
}

/**
 * Groups TaskRuns by pipeline task name and detects matrix tasks
 * Matrix tasks are identified purely by having multiple TaskRuns with the same pipeline task name
 */
export const detectMatrixTasks = (taskRuns: TaskRunKind[]): Map<string, MatrixTaskInfo> => {
  if (!taskRuns || taskRuns.length === 0) {
    return new Map();
  }

  // Group TaskRuns by pipeline task name
  const taskRunsByTaskName = new Map<string, TaskRunKind[]>();

  taskRuns.forEach((taskRun) => {
    // Try to get task name from different possible sources
    let taskName = taskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask];
    
    // If not found in labels, try to get from pipelineTaskName field (for childReferences)
    if (!taskName && (taskRun as { pipelineTaskName?: string }).pipelineTaskName) {
      taskName = (taskRun as { pipelineTaskName?: string }).pipelineTaskName;
    }
    
    if (taskName) {
      const existing = taskRunsByTaskName.get(taskName) || [];
      existing.push(taskRun);
      taskRunsByTaskName.set(taskName, existing);
    } else {

    }
  });

  // Analyze each task for matrix patterns
  const matrixTasks = new Map<string, MatrixTaskInfo>();

  taskRunsByTaskName.forEach((taskRunList, taskName) => {
    const instanceCount = taskRunList.length;

    // Consider it a matrix task if multiple instances exist
    // This is the most reliable indicator from childReferences
    const isMatrix = instanceCount > 1;

    matrixTasks.set(taskName, {
      taskName,
      isMatrix,
      instanceCount,
    });
  });

  return matrixTasks;
};

/**
 * Performance-optimized matrix detection with memoization support
 */
const matrixDetectionCache = new Map<string, Map<string, MatrixTaskInfo>>();

export const detectMatrixTasksWithCaching = (
  taskRuns: TaskRunKind[],
  cacheKey?: string,
): Map<string, MatrixTaskInfo> => {
  // Generate cache key if not provided
  const key = cacheKey || `${taskRuns.length}-${Date.now()}`;

  // Check cache first
  const cached = matrixDetectionCache.get(key);
  if (cached) {
    return cached;
  }

  // Perform detection
  const result = detectMatrixTasks(taskRuns);

  // Cache result (with size limit)
  if (matrixDetectionCache.size > 100) {
    // Clear oldest entries
    const entries = Array.from(matrixDetectionCache.keys());
    entries.slice(0, 50).forEach((k) => matrixDetectionCache.delete(k));
  }

  matrixDetectionCache.set(key, result);
  return result;
};

/**
 * Clears the matrix detection cache
 */
export const clearMatrixDetectionCache = (): void => {
  matrixDetectionCache.clear();
};
