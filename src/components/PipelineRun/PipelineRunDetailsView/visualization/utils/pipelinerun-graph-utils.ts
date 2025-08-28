import {
  DEFAULT_LAYERS,
  ElementModel,
  getEdgesFromNodes,
  getSpacerNodes,
  GraphElement,
  GraphModel,
  ModelKind,
  Node,
  WhenStatus,
} from '@patternfly/react-topology';
import { PipelineNodeModel } from '@patternfly/react-topology/src/pipelines/types';
import { isCVEScanResult } from '../../../../../hooks/useScanResults';
import { formatPrometheusDuration } from '../../../../../shared/components/timestamp/datetime';
import {
  TaskRunKind,
  TaskRunStatus,
  TektonResourceLabel,
  PipelineKind,
  PipelineTask,
  PipelineRunKind,
  PLRTaskRunStep,
  TektonResultsRun,
} from '../../../../../types';
import { detectMatrixTasks } from '../../../../../utils/matrix-pipeline-utils';
import {
  pipelineRunStatus,
  runStatus,
  taskRunStatus,
  isTaskV1Beta1,
} from '../../../../../utils/pipeline-utils';
import { DEFAULT_FINALLLY_GROUP_PADDING, DEFAULT_NODE_HEIGHT } from '../../../../topology/const';
import { PipelineLayout } from '../../../../topology/factories';
import { NodeType, PipelineEdgeModel, PipelineMixedNodeModel } from '../../../../topology/types';
import { getLabelWidth, getTextWidth } from '../../../../topology/utils';
import {
  PipelineRunNodeData,
  PipelineRunNodeModel,
  PipelineRunNodeType,
  PipelineTaskStatus,
  PipelineTaskWithStatus,
  StepStatus,
} from '../types';

enum TerminatedReasons {
  Completed = 'Completed',
}

export const extractDepsFromContextVariables = (contextVariable: string): string[] => {
  const regex = /(?:(?:\$\(tasks.))([a-z0-9_-]+)(?:.results+)(?:[.^\w]+\))/g;
  let matches;
  const deps = [];
  while ((matches = regex.exec(contextVariable)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (matches.index === regex.lastIndex) {
      regex.lastIndex++;
    }
    if (matches) {
      if (!deps.includes(matches[1])) {
        deps.push(matches[1]);
      }
    }
  }
  return deps;
};

const getMatchingStep = (
  stepName: string,
  status: PipelineTaskStatus,
): [PLRTaskRunStep, PLRTaskRunStep] => {
  const statusSteps: PLRTaskRunStep[] = status?.steps || [];
  let prevStep: PLRTaskRunStep = null;
  const result = statusSteps.find((statusStep) => {
    // In rare occasions the status step name is prefixed with `step-`
    // This is likely a bug but this workaround will be temporary as it's investigated separately
    const found = statusStep.name === stepName || statusStep.name === `step-${stepName}`;
    if (!found) {
      prevStep = statusStep;
    }
    return found;
  });
  return [result, prevStep];
};

export const getPipelineFromPipelineRun = (pipelineRun: PipelineRunKind): PipelineKind => {
  const PIPELINE_LABEL = 'tekton.dev/pipeline';
  const pipelineName =
    pipelineRun?.metadata?.labels?.[PIPELINE_LABEL] || pipelineRun?.metadata?.name;
  const pipelineSpec = pipelineRun?.status?.pipelineSpec || pipelineRun?.spec?.pipelineSpec;

  if (!pipelineName || !pipelineSpec) {
    return null;
  }
  return {
    apiVersion: pipelineRun.apiVersion,
    kind: 'Pipeline',
    metadata: {
      name: pipelineName,
      namespace: pipelineRun.metadata.namespace,
    },
    spec: pipelineSpec,
  };
};

export const createStepStatus = (
  stepName: string,
  status: PipelineTaskStatus,
  isFinalStep: boolean = false,
): StepStatus => {
  let stepRunStatus: runStatus = runStatus.Pending;
  let startTime: string;
  let endTime: string;

  const [matchingStep, prevStep] = getMatchingStep(stepName, status);
  if (!status || !status.reason) {
    stepRunStatus = runStatus.Cancelled;
  } else {
    if (!matchingStep) {
      stepRunStatus = runStatus.Pending;
    } else if (matchingStep.terminated) {
      stepRunStatus =
        status.reason === runStatus.TestFailed && isFinalStep
          ? runStatus.TestFailed
          : matchingStep.terminated.reason === TerminatedReasons.Completed
            ? runStatus.Succeeded
            : runStatus.Failed;
      startTime = matchingStep.terminated.startedAt;
      endTime = matchingStep.terminated.finishedAt;
    } else if (matchingStep.running) {
      if (!prevStep) {
        stepRunStatus = runStatus.Running;
        startTime = matchingStep.running.startedAt;
      } else if (prevStep.terminated) {
        stepRunStatus = runStatus.Running;
        startTime = prevStep.terminated.finishedAt;
      } else {
        stepRunStatus = runStatus.Pending;
      }
    } else if (matchingStep.waiting) {
      stepRunStatus = runStatus.Pending;
    }
  }

  return {
    startTime,
    endTime,
    name: stepName,
    status: stepRunStatus,
  };
};

/**
 * Appends the pipeline run status to each tasks in the pipeline.
 * @param pipeline
 * @param pipelineRun
 * @param taskRuns
 * @param isFinallyTasks
 */
// Extended type for matrix tasks
type MatrixPipelineTaskWithStatus = PipelineTaskWithStatus & {
  originalName?: string;
  matrixParameter?: string;
  matrixValue?: string;
  matrixDisplayName?: string;
  isMatrix?: boolean;
};

// Helper function to create a task with status from a TaskRun
const createTaskWithStatus = (
  task: PipelineTask,
  taskRun?: TaskRunKind,
): PipelineTaskWithStatus => {
  if (!taskRun) {
    return { ...task, status: { reason: runStatus.Idle } };
  }

  const taskStatus: TaskRunStatus = taskRun.status;
  const taskResults = isTaskV1Beta1(taskRun)
    ? taskRun.status?.taskResults
    : taskRun.status?.results;

  const mTask: PipelineTaskWithStatus = {
    ...task,
    status: { ...taskStatus, reason: runStatus.Pending },
  };

  // append task duration
  if (mTask.status.completionTime && mTask.status.startTime) {
    const date =
      new Date(mTask.status.completionTime).getTime() - new Date(mTask.status.startTime).getTime();
    mTask.status.duration = formatPrometheusDuration(date);
  }

  // append task status
  if (mTask.status.conditions) {
    mTask.status.reason = taskRunStatus(taskRun);
  }

  // Determine any task test status
  if (taskResults) {
    const testOutput: TektonResultsRun = taskResults.find(
      (result) => result.name === 'HACBS_TEST_OUTPUT' || result.name === 'TEST_OUTPUT',
    );
    if (testOutput) {
      try {
        const outputValues = JSON.parse(testOutput.value);
        mTask.status.testFailCount = parseInt(outputValues.failures as string, 10);
        mTask.status.testWarnCount = parseInt(outputValues.warnings as string, 10);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(e);
      }
    }
    const scanResult = taskResults?.find((result) => isCVEScanResult(result));

    if (scanResult) {
      try {
        mTask.status.scanResults = JSON.parse(scanResult.value);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(e);
      }
    }
  }

  // Get the steps status
  const stepList = taskStatus?.steps || mTask?.steps || mTask?.taskSpec?.steps || [];
  mTask.steps = stepList.map((step, i, { length }) =>
    createStepStatus(step.name as string, mTask.status, i + 1 === length),
  );

  return mTask;
};

// Helper function to create a matrix task entry
/**
 * Sanitizes displayName values to prevent XSS attacks
 * @param displayName - The display name to sanitize
 * @returns Sanitized display name with a maximum length of 100 characters
 */
const sanitizeDisplayName = (displayName: string): string => {
  if (!displayName) return '';

  // Remove HTML tags and dangerous characters
  const sanitized = displayName
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>&]/g, '') // Remove dangerous characters but keep quotes for readability
    .trim();

  // Limit length to prevent UI issues
  return sanitized.length > 100 ? sanitized.substring(0, 100) : sanitized;
};

/**
 * Sanitizes a string for use as a name suffix, replacing non-alphanumeric characters with dashes
 * and collapsing multiple consecutive dashes into single dashes
 * @param input - The input string to sanitize
 * @returns Sanitized string suitable for use as a name suffix
 */
const sanitizeNameSuffix = (input: string): string => {
  if (!input) return '';
  
  return input
    .replace(/[^a-zA-Z0-9]/g, '-') // Replace non-alphanumeric with dash
    .replace(/-+/g, '-') // Collapse multiple consecutive dashes into single dash
    .replace(/^-|-$/g, ''); // Remove leading and trailing dashes
};

/**
 * Looks up displayName from PipelineRun.status.childReferences for a specific TaskRun
 * @param pipelineRun - The PipelineRun containing childReferences
 * @param taskRunName - The name of the TaskRun to find displayName for
 * @returns The sanitized displayName if found, undefined otherwise
 */
const getDisplayNameFromChildReferences = (
  pipelineRun: PipelineRunKind,
  taskRunName: string,
): string | undefined => {
  const childReferences = pipelineRun.status?.childReferences;
  if (!childReferences) return undefined;

  const childRef = (childReferences as Array<{ name: string; displayName?: string }>).find(
    (ref) => ref.name === taskRunName,
  );
  if (!childRef?.displayName) return undefined;

  return sanitizeDisplayName(childRef.displayName);
};

/**
 * Creates individual matrix instance labels based on specific parameter values
 * Each matrix instance gets its own unique label
 */
export const createMatrixInstanceLabel = (
  task: PipelineTask,
  taskRun: TaskRunKind,
  pipelineRun: PipelineRunKind,
  index: number,
): string => {
  // Priority 1: Try to get displayName from childReferences
  const taskRunName = taskRun.metadata?.name;
  const childRefDisplayName = taskRunName
    ? getDisplayNameFromChildReferences(pipelineRun, taskRunName)
    : undefined;

  if (childRefDisplayName) {
    return childRefDisplayName;
  }

  // Priority 2: Create label from actual TaskRun matrix parameter values
  const matrixParams = (task as any).matrix?.params;
  if (matrixParams && matrixParams.length > 0) {
    // Get matrix parameter names from pipeline definition
    const matrixParamNames = matrixParams.map(p => p.name);
    
    // Get actual parameter values from TaskRun
    const taskRunParams = taskRun.spec?.params || [];
    
    // Filter to only matrix parameters and get their values
    const matrixParamValues = taskRunParams
      .filter(param => matrixParamNames.includes(param.name))
      .map(param => param.value);
    
    // For single parameter matrices, show the specific value for this instance
    if (matrixParams.length === 1) {
      const param = matrixParams[0];
      const values = Array.isArray(param.value) ? param.value : [param.value];
      if (values[index] !== undefined) {
        return `${values[index]}`;
      }
    }
    
    // For multiple parameter matrices, use actual TaskRun parameter values
    const paramValues: string[] = [];
    
    // Calculate the total number of combinations
    const totalCombinations = matrixParams.reduce((total, param) => {
      const values = Array.isArray(param.value) ? param.value : [param.value];
      return total * values.length;
    }, 1);
    
    if (index < totalCombinations) {
      // Use actual TaskRun parameter values instead of calculating combinations
      if (matrixParamValues.length > 0) {
        return matrixParamValues.join(', ');
      }
      
      // Fallback to combination calculation if TaskRun params not available
      let remainingIndex = index;
      for (const param of matrixParams) {
        const values = Array.isArray(param.value) ? param.value : [param.value];
        const paramIndex = remainingIndex % values.length;
        paramValues.push(`${values[paramIndex]}`);
        remainingIndex = Math.floor(remainingIndex / values.length);
      }
    }
    
    if (paramValues.length < 4) {
      return paramValues.join(', ');
    }
  }

  // Priority 3: Fallback to generic instance naming
  return `Instance ${index + 1}`;
};

const createMatrixTaskEntry = (
  task: PipelineTask,
  taskRun: TaskRunKind,
  pipelineRun: PipelineRunKind,
  matrixParameter?: string,
  matrixValue?: string,
  matrixDisplayName?: string,
): MatrixPipelineTaskWithStatus => {
  const matrixTask = createTaskWithStatus(task, taskRun) as MatrixPipelineTaskWithStatus;

  // Priority 1: Try to get displayName from childReferences (highest priority)
  const taskRunName = taskRun.metadata?.name;
  const childRefDisplayName = taskRunName
    ? getDisplayNameFromChildReferences(pipelineRun, taskRunName)
    : undefined;

  // Determine display name and suffix for the task name
  let displayName: string;
  let nameSuffix: string;

  if (childRefDisplayName) {
    // Use displayName from childReferences (highest priority)
    displayName = childRefDisplayName;
    nameSuffix = sanitizeNameSuffix(childRefDisplayName);
  } else if (matrixDisplayName) {
    // Use provided matrixDisplayName (fallback)
    displayName = sanitizeDisplayName(matrixDisplayName);
    nameSuffix = sanitizeNameSuffix(displayName);
  } else if (matrixValue) {
    // Use matrixValue as display name
    displayName = matrixValue;
    nameSuffix = sanitizeNameSuffix(matrixValue);
  } else {
    displayName = 'unknown';
    nameSuffix = 'unknown';
  }

  // Add suffix to make the name unique for React rendering
  // But preserve original name for dependency resolution
  matrixTask.name = `${task.name}-${nameSuffix}`;

  // Store original name and matrix info for later use
  matrixTask.originalName = task.name;
  matrixTask.matrixParameter = matrixParameter;
  matrixTask.matrixValue = matrixValue;
  matrixTask.matrixDisplayName = displayName;
  matrixTask.isMatrix = true;

  return matrixTask;
};

export const appendStatus = (
  pipeline: PipelineKind,
  pipelineRun: PipelineRunKind,
  taskRuns: TaskRunKind[],
  isFinallyTasks = false,
): PipelineTaskWithStatus[] => {
  // Handle null pipeline case
  if (!pipeline) {
    return [];
  }

  const tasks = (isFinallyTasks ? pipeline.spec.finally : pipeline.spec.tasks) || [];
  const overallPipelineRunStatus = pipelineRunStatus(pipelineRun);

  // Use generic matrix detection to identify matrix tasks
  const matrixTasksMap = detectMatrixTasks(taskRuns || []);

  // Group TaskRuns by pipeline task name for processing
  const taskRunsByTaskName = new Map<string, TaskRunKind[]>();
  taskRuns?.forEach((tr) => {
    // Try to get task name from different possible sources
    let taskName = tr.metadata?.labels?.[TektonResourceLabel.pipelineTask];
    
    // If not found in labels, try to get from pipelineTaskName field (for childReferences)
    if (!taskName && (tr as { pipelineTaskName?: string }).pipelineTaskName) {
      taskName = (tr as { pipelineTaskName?: string }).pipelineTaskName;
    }
    
    if (taskName) {
      const existingTaskRuns = taskRunsByTaskName.get(taskName) || [];
      existingTaskRuns.push(tr);
      taskRunsByTaskName.set(taskName, existingTaskRuns);
    }
  });

  // Process each pipeline task, expanding matrix tasks into multiple entries
  const result: PipelineTaskWithStatus[] = [];

  tasks.forEach((task) => {
    if (!pipelineRun?.status) {
      result.push({ ...task, status: { reason: runStatus.Pending } });
      return;
    }
    if (!taskRuns || taskRuns.length === 0) {
      result.push({ ...task, status: { reason: overallPipelineRunStatus } });
      return;
    }

    const taskRunsForTask = taskRunsByTaskName.get(task.name) || [];

    // If no TaskRuns found, create a single task entry
    if (taskRunsForTask.length === 0) {
      const isSkipped = !!pipelineRun.status.skippedTasks?.find((t) => t.name === task.name);
      result.push({
        ...task,
        status: { reason: isSkipped ? runStatus.Skipped : runStatus.Idle },
      });
      return;
    }

    // Check if this is a matrix task using multiple detection methods:
    // 1. Generic matrix detection from TaskRuns
    // 2. Multiple TaskRuns for this task (indicating it's a matrix task)
    const matrixInfo = matrixTasksMap.get(task.name);
    const hasMultipleTaskRuns = taskRunsForTask.length > 1;

    if (matrixInfo?.isMatrix || hasMultipleTaskRuns) {
      // Matrix task detected - create one entry per matrix instance
      // This shows matrix tasks as individual parallel nodes while maintaining proper dependency resolution
      taskRunsForTask.forEach((taskRun, index) => {
        // Use createMatrixInstanceLabel to generate meaningful labels
        const matrixLabel = createMatrixInstanceLabel(task, taskRun, pipelineRun, index);
        
        // Create matrix task entries with meaningful labels
        const matrixTask = createMatrixTaskEntry(
          task,
          taskRun,
          pipelineRun,
          undefined, // Let the function determine the parameter name
          matrixLabel, // Use the generated meaningful label
        );
        result.push(matrixTask);
      });
    } else {
      // Regular task - create single entry
      const taskRun = taskRunsForTask[0];
      const regularTask = createTaskWithStatus(task, taskRun);
      result.push(regularTask);
    }
  });

  return result;
};

export const taskHasWhenExpression = (task: PipelineTask): boolean => task?.when?.length > 0;

export const nodesHasWhenExpression = (nodes: PipelineMixedNodeModel[]): boolean =>
  nodes.some((n) => taskHasWhenExpression(n.data?.task as PipelineTask));

export const getWhenStatus = (status: runStatus): WhenStatus => {
  switch (status) {
    case runStatus.Succeeded:
    case runStatus.Failed:
      return WhenStatus.Met;
    case runStatus.Skipped:
    case runStatus['In Progress']:
    case runStatus.Idle:
      return WhenStatus.Unmet;
    default:
      return undefined;
  }
};

export const taskWhenStatus = (task: PipelineTaskWithStatus): WhenStatus | undefined => {
  if (!task.when) {
    return undefined;
  }

  return getWhenStatus(task.status?.reason);
};

export const getTaskBadgeCount = (data: PipelineRunNodeData): number =>
  (data.testFailCount ?? 0) + (data.testWarnCount ?? 0) ||
  (data.scanResults?.vulnerabilities?.critical ?? 0) +
    (data.scanResults?.vulnerabilities?.high ?? 0) +
    (data.scanResults?.vulnerabilities?.medium ?? 0) +
    (data.scanResults?.vulnerabilities?.low ?? 0) +
    (data.scanResults?.vulnerabilities?.unknown ?? 0);

const getBadgeWidth = (data: PipelineRunNodeData, font: string = '0.875rem RedHatText'): number => {
  const BADGE_PADDING = 24; // 8 before the badge and 8 on each side of the text inside the badge
  const badgeCount = getTaskBadgeCount(data);

  if (!badgeCount) {
    return 0;
  }
  return BADGE_PADDING + getTextWidth(`${badgeCount}`, font);
};

const getNodeLevel = (
  node: PipelineRunNodeModel<PipelineRunNodeData, PipelineRunNodeType>,
  allNodes: PipelineRunNodeModel<PipelineRunNodeData, PipelineRunNodeType>[],
) => {
  const children = allNodes.filter((n) => n.runAfterTasks?.includes(node.id));
  if (!children.length) {
    return 0;
  }
  const maxChildLevel = children.reduce(
    (maxLevel, child) => Math.max(getNodeLevel(child, allNodes) as number, maxLevel),
    0,
  );

  return maxChildLevel + 1;
};

const hasParentDep = (
  dep: string,
  otherDeps: string[],
  nodes: PipelineRunNodeModel<PipelineRunNodeData, PipelineRunNodeType>[],
): boolean => {
  if (!otherDeps?.length) {
    return false;
  }

  for (const otherDep of otherDeps) {
    if (otherDep === dep) {
      continue;
    }
    const depNode = nodes.find((n) => n.id === otherDep);
    if (!depNode) {
      // Try to find by original name (for matrix tasks)
      const depNodeByOriginal = nodes.find((n) => {
        const matrixTask = n.data.task as MatrixPipelineTaskWithStatus;
        return matrixTask.originalName === otherDep;
      });
      if (
        depNodeByOriginal?.runAfterTasks?.includes(dep) ||
        hasParentDep(dep, depNodeByOriginal?.runAfterTasks || [], nodes)
      ) {
        return true;
      }
    }
    if (depNode?.runAfterTasks?.includes(dep) || hasParentDep(dep, depNode?.runAfterTasks || [], nodes)) {
      return true;
    }
  }
  return false;
};

// Helper function to expand matrix task dependencies
const expandMatrixDependencies = (deps: string[], taskList: PipelineTaskWithStatus[]): string[] => {
  const expandedDeps: string[] = [];

  deps.forEach((dep) => {
    // Find all matrix instances of this dependency
    const matrixInstances = taskList.filter((task) => {
      const matrixTask = task as MatrixPipelineTaskWithStatus;
      // Check if this task is a matrix instance of the dependency
      return matrixTask.originalName === dep;
    });

    if (matrixInstances.length > 1) {
      // This is a matrix task - add all instances
      matrixInstances.forEach((instance) => expandedDeps.push(instance.name));
    } else if (matrixInstances.length === 1) {
      // Single matrix instance - add it
      expandedDeps.push(matrixInstances[0].name);
    } else {
      // Regular task - add as is
      expandedDeps.push(dep);
    }
  });

  return expandedDeps;
};

const getGraphDataModel = (
  pipeline: PipelineKind,
  pipelineRun?: PipelineRunKind,
  taskRuns?: TaskRunKind[],
): {
  graph: GraphModel;
  nodes: (PipelineRunNodeModel<PipelineRunNodeData, PipelineRunNodeType> | PipelineNodeModel)[];
  edges: PipelineEdgeModel[];
} => {
  

  const taskList = appendStatus(pipeline, pipelineRun, taskRuns);

  const nodes: PipelineRunNodeModel<PipelineRunNodeData, PipelineRunNodeType>[] = taskList.map(
    (task) => {
      const runAfterTasks = [...(task.runAfter || [])];
      if (task.params) {
        task.params.map((p) => {
          if (Array.isArray(p.value)) {
            p.value.forEach((paramValue: string) => {
              runAfterTasks.push(...extractDepsFromContextVariables(paramValue));
            });
          } else {
            runAfterTasks.push(...extractDepsFromContextVariables(p.value as string));
          }
        });
      }
      if (task?.when) {
        task.when.forEach(({ input, values }) => {
          runAfterTasks.push(...extractDepsFromContextVariables(input));
          values.forEach((whenValue) => {
            runAfterTasks.push(...extractDepsFromContextVariables(whenValue));
          });
        });
      }

      // Expand matrix task dependencies
      const expandedRunAfterTasks = expandMatrixDependencies(runAfterTasks, taskList);

      // For matrix tasks, use matrixDisplayName for better labels
      // Only apply matrix formatting if this is actually a matrix task
      const matrixTask = task as MatrixPipelineTaskWithStatus;
      const displayName = matrixTask.isMatrix && matrixTask.matrixDisplayName
        ? `${matrixTask.originalName || task.name} (${matrixTask.matrixDisplayName})`
        : task.name;

      // Find TaskRun for this task
      let taskRunForTask: TaskRunKind | undefined;
      if (matrixTask.isMatrix && matrixTask.originalName) {
        // Matrix task - find TaskRun by original name
        taskRunForTask = taskRuns.find(
          (tr) => tr.metadata.labels[TektonResourceLabel.pipelineTask] === matrixTask.originalName,
        );
      } else {
        // Regular task - find by task name
        taskRunForTask = taskRuns.find(
          (tr) => tr.metadata.labels[TektonResourceLabel.pipelineTask] === task.name,
        );
      }

      // For matrix tasks, use the instance-specific name as the ID to show individual parallel nodes
      // For regular tasks, use the task name as is
      const nodeId = task.name;

      return {
        id: nodeId,
        type: PipelineRunNodeType.TASK_NODE,
        label: displayName,
        runAfterTasks: expandedRunAfterTasks,
        height: DEFAULT_NODE_HEIGHT,
        data: {
          namespace: pipelineRun.metadata.namespace,
          status: task.status?.reason,
          testFailCount: task.status.testFailCount,
          testWarnCount: task.status.testWarnCount,
          scanResults: task.status.scanResults,
          whenStatus: taskWhenStatus(task),
          task,
          steps: task.steps,
          taskRun: taskRunForTask,
        },
      };
    },
  );

  // Remove extraneous dependencies
  nodes.forEach(
    (taskNode) =>
      (taskNode.runAfterTasks = taskNode.runAfterTasks.filter(
        (dep) => !hasParentDep(dep, taskNode.runAfterTasks, nodes),
      )),
  );

  // Validate that all runAfterTasks references point to existing nodes
  const validNodeIds = new Set(nodes.map(n => n.id));
  nodes.forEach((taskNode) => {
    taskNode.runAfterTasks = taskNode.runAfterTasks.filter(dep => validNodeIds.has(dep));
  });

  // Set the level and width of each node
  nodes.forEach((taskNode) => {
    taskNode.data.level = getNodeLevel(taskNode, nodes);
    taskNode.width =
      getLabelWidth(taskNode.label) + getBadgeWidth(taskNode.data as PipelineRunNodeData);
  });

  // Set the width of nodes to the max width for it's level
  nodes.forEach((taskNode) => {
    const levelNodes = nodes.filter((n) => n.data.level === taskNode.data.level);
    taskNode.width = levelNodes.reduce((maxWidth, n) => Math.max(n.width, maxWidth), 0);
  });

  const finallyTaskList = appendStatus(pipeline, pipelineRun, taskRuns, true);

  const maxFinallyNodeName =
    finallyTaskList.sort((a, b) => b.name.length - a.name.length)[0]?.name || '';
  const finallyNodes = finallyTaskList.map((fTask) => ({
    type: PipelineRunNodeType.FINALLY_NODE,
    id: fTask.name,
    label: fTask.name,
    runAfterTasks: [],
    width: getLabelWidth(maxFinallyNodeName),
    height: DEFAULT_NODE_HEIGHT,
    data: {
      namespace: pipelineRun.metadata.namespace,
      status: fTask.status.reason,
      whenStatus: taskWhenStatus(fTask),
      task: fTask,
      taskRun: taskRuns.find(
        (tr) => tr.metadata.labels[TektonResourceLabel.pipelineTask] === fTask.name,
      ),
    },
  }));
  const finallyGroup = finallyNodes.length
    ? [
        {
          id: 'finally-group-id',
          type: PipelineRunNodeType.FINALLY_GROUP,
          children: finallyNodes.map((n) => n.id),
          group: true,
          style: { padding: DEFAULT_FINALLLY_GROUP_PADDING },
        },
      ]
    : [];
  const spacerNodes: PipelineMixedNodeModel[] = getSpacerNodes(
    [...nodes, ...finallyNodes],
    NodeType.SPACER_NODE,
    [PipelineRunNodeType.FINALLY_NODE],
  );

  const edges: PipelineEdgeModel[] = getEdgesFromNodes(
    [...nodes, ...spacerNodes, ...finallyNodes],
    PipelineRunNodeType.SPACER_NODE,
    PipelineRunNodeType.EDGE,
    PipelineRunNodeType.EDGE,
    [PipelineRunNodeType.FINALLY_NODE],
    PipelineRunNodeType.EDGE,
  );
  const allNodes = [...nodes, ...spacerNodes, ...finallyNodes, ...finallyGroup];
  const hasWhenExpression = nodesHasWhenExpression(allNodes);

  return {
    graph: {
      id: 'pipelinerun-vis-graph',
      type: ModelKind.graph,
      layout: hasWhenExpression
        ? PipelineLayout.PIPELINERUN_VISUALIZATION_SPACED
        : PipelineLayout.PIPELINERUN_VISUALIZATION,
      layers: DEFAULT_LAYERS,
      y: finallyGroup.length ? 50 : 40,
      x: 15,
    },
    nodes: allNodes,
    edges,
  };
};

export const getPipelineRunDataModel = (pipelineRun: PipelineRunKind, taskRuns: TaskRunKind[]) => {
  if (!pipelineRun?.status?.pipelineSpec) {
    return null;
  }
  return getGraphDataModel(getPipelineFromPipelineRun(pipelineRun), pipelineRun, taskRuns);
};

export const isTaskNode = (e?: GraphElement): e is Node<ElementModel, PipelineRunNodeData> =>
  e?.getType() === PipelineRunNodeType.TASK_NODE ||
  e?.getType() === PipelineRunNodeType.FINALLY_NODE;

export const scrollNodeIntoView = (node: Node, scrollPane: HTMLElement) => {
  const targetNode = scrollPane.querySelector(`[data-id="${node.getId()}"]`);
  if (targetNode) {
    if (scrollPane.ownerDocument.defaultView.navigator.userAgent.search('Firefox') !== -1) {
      // Fix for firefox which does not take into consideration the full SVG node size with #scrollIntoView
      let left: number = null;
      const nodeBounds = node.getBounds();
      const scrollLeftEdge = nodeBounds.x;
      const scrollRightEdge = nodeBounds.x + nodeBounds.width - scrollPane.offsetWidth;
      if (scrollPane.scrollLeft < scrollRightEdge) {
        left = scrollRightEdge;
      } else if (scrollPane.scrollLeft > scrollLeftEdge) {
        left = scrollLeftEdge;
      }
      if (left != null) {
        scrollPane.scrollTo({ left, behavior: 'smooth' });
      }
    } else {
      targetNode.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }
};
