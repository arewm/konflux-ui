import * as React from 'react';
import { Nav, NavItem, NavList } from '@patternfly/react-core';
import { css } from '@patternfly/react-styles';
import get from 'lodash/get';
import { createMatrixInstanceLabel } from '../../../components/PipelineRun/PipelineRunDetailsView/visualization/utils/pipelinerun-graph-utils';
import { ColoredStatusIcon } from '../../../components/topology/StatusIcon';
import { PodGroupVersionKind } from '../../../models/pod';
import { PipelineRunKind, PipelineTask, TaskRunKind, TektonResourceLabel } from '../../../types';
import { WatchK8sResource } from '../../../types/k8s';
import { pipelineRunStatus, runStatus, taskRunStatus } from '../../../utils/pipeline-utils';
import { ErrorDetailsWithStaticLog } from './logs/log-snippet-types';
import { getDownloadAllLogsCallback } from './logs/logs-utils';
import LogsWrapperComponent from './logs/LogsWrapperComponent';
import { getPLRLogSnippet } from './logs/pipelineRunLogSnippet';

import './PipelineRunLogs.scss';

interface PipelineRunLogsProps {
  className?: string;
  obj: PipelineRunKind;
  taskRuns: TaskRunKind[];
  activeTask?: string;
  onActiveTaskChange?: (taskName: string, index?: number) => void;
}
interface PipelineRunLogsState {
  activeItem: string;
  navUntouched: boolean;
}
class PipelineRunLogs extends React.Component<PipelineRunLogsProps, PipelineRunLogsState> {
  constructor(props: PipelineRunLogsProps) {
    super(props);
    this.state = { 
      activeItem: null, 
      navUntouched: true
    };
  }

  componentDidMount() {
    this.updateActiveItemFromProps(this.props);
  }

  componentDidUpdate(prevProps: PipelineRunLogsProps) {
    // Check if URL parameters have changed
    const prevUrlParams = new URLSearchParams(window.location.search);
    const currentUrlParams = new URLSearchParams(window.location.search);
    
    if (prevProps.activeTask !== this.props.activeTask || 
        prevUrlParams.get('index') !== currentUrlParams.get('index')) {
      this.updateActiveItemFromProps(this.props);
    }
  }

  private updateActiveItemFromProps = (props: PipelineRunLogsProps) => {
    const { activeTask, taskRuns, obj } = props;
    
    if (taskRuns.length > 0) {
      if (activeTask) {
        // Find the task by name
        const taskName = activeTask;
        
        // Check if we have an index parameter in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const indexParam = urlParams.get('index');
        
        if (indexParam !== null) {
          // We have an index parameter, find the specific matrix instance
          const matrixTaskRuns = taskRuns.filter(tr => 
            tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === taskName
          );
          
          // Sort by the index extracted from TaskRun name
          matrixTaskRuns.sort((a, b) => {
            const aMatch = a.metadata.name.match(/-(\d+)$/);
            const bMatch = b.metadata.name.match(/-(\d+)$/);
            const aIndex = aMatch ? parseInt(aMatch[1], 10) : 0;
            const bIndex = bMatch ? parseInt(bMatch[1], 10) : 0;
            return aIndex - bIndex;
          });
          
          const targetIndex = parseInt(indexParam, 10);
          if (matrixTaskRuns[targetIndex]) {
            this.setState({ activeItem: matrixTaskRuns[targetIndex].metadata.name });
            return;
          }
        }
        
        // No index parameter or index not found, find the first TaskRun for this task
        const firstTaskRun = taskRuns.find(tr => 
          tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === taskName
        );
        if (firstTaskRun) {
          this.setState({ activeItem: firstTaskRun.metadata.name });
          return;
        }
      }
      
      // No activeTask specified, use fallback logic to select a default TaskRun
      const sortedTaskRuns = this.getSortedTaskRun(taskRuns, [
        ...(obj?.status?.pipelineSpec?.tasks || []),
        ...(obj?.status?.pipelineSpec?.finally || []),
      ]);
      const defaultActiveItem = this.getActiveTaskRun(sortedTaskRuns, activeTask);
      if (defaultActiveItem) {
        this.setState({ activeItem: defaultActiveItem });
      }
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps: PipelineRunLogsProps) {
    if (this.props.obj !== nextProps.obj || this.props.taskRuns !== nextProps.taskRuns) {
      const { activeTask, taskRuns } = nextProps;
      const sortedTaskRuns = this.getSortedTaskRun(taskRuns, [
        ...(nextProps?.obj?.status?.pipelineSpec?.tasks || []),
        ...(nextProps?.obj?.status?.pipelineSpec?.finally || []),
      ]);
      const activeItem = this.getActiveTaskRun(sortedTaskRuns, activeTask);
      this.state.navUntouched && this.setState({ activeItem });
    }
  }



  getActiveTaskRun = (taskRuns: TaskRunKind[], activeTask: string): string => {
    // If activeTask is a TaskRun name (contains a dash and number), find it directly
    if (activeTask && activeTask.match(/-(\d+)$/)) {
      const taskRun = taskRuns.find((tr) => tr.metadata.name === activeTask);
      if (taskRun) {
        return taskRun.metadata.name;
      }
    }
    
    // If activeTask is a pipeline task name, find the first TaskRun for that task
    if (activeTask) {
      const foundTaskRun = taskRuns.find((tr) => 
        tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === activeTask
      );
      if (foundTaskRun) {
        return foundTaskRun.metadata.name;
      }
    }
    
    // Fallback: find failed task or last task
    return taskRuns.find((taskRun) => taskRunStatus(taskRun) === runStatus.Failed)?.metadata.name ||
           taskRuns[taskRuns.length - 1]?.metadata.name;
  };

  getTaskRunName = (taskRunName: string) => {
    return this.props.taskRuns.find((taskRun) => taskRun.metadata.name === taskRunName)?.metadata
      ?.labels?.[TektonResourceLabel.pipelineTask];
  };

  getMatrixInstanceIndex(taskRun: TaskRunKind): number {
    // Priority 1: Try to get the actual Tekton matrix index from the TaskRun
    // This would be the most reliable if Tekton provides it
    if (taskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask]) {
      // Check if there's a Tekton matrix index label
      const tektonMatrixIndex = taskRun.metadata?.labels?.['tekton.dev/matrix-index'];
      if (tektonMatrixIndex !== undefined) {
        const index = parseInt(tektonMatrixIndex, 10);
        if (!isNaN(index)) {
          return index;
        }
      }
    }

    // Priority 2: Extract index from the TaskRun name (e.g., "task-name-0" → index 0)
    // This is the most reliable method as Tekton assigns these indices deterministically
    const nameIndexMatch = taskRun.metadata?.name?.match(/-(\d+)$/);
    if (nameIndexMatch) {
      const extractedIndex = parseInt(nameIndexMatch[1], 10);
      if (!isNaN(extractedIndex)) {
        return extractedIndex;
      }
    }

    // If we can't extract the index, something is wrong with the TaskRun data
    // Return 0 as a safe default to maintain sorting stability
    return 0;
  }




  getSortedTaskRun = (tRuns: TaskRunKind[], tasks: PipelineTask[]): TaskRunKind[] => {
    const { obj } = this.props;
    
    const taskRuns = tRuns?.sort((a, b) => {
      if (get(a, ['status', 'completionTime'], false)) {
        return b.status?.completionTime &&
          new Date(a.status.completionTime) > new Date(b.status.completionTime)
          ? 1
          : -1;
      }
      return b.status?.completionTime ||
        new Date(a.status?.startTime) > new Date(b.status?.startTime)
        ? 1
        : -1;
    });

    const pipelineTaskNames = tasks?.map((t) => t?.name);
    

    
    // First sort by pipeline task order
    const sortedTaskRuns = taskRuns?.sort(
      (c, d) =>
        pipelineTaskNames?.indexOf(c?.metadata?.labels?.[TektonResourceLabel.pipelineTask]) -
        pipelineTaskNames?.indexOf(d?.metadata?.labels?.[TektonResourceLabel.pipelineTask]),
    ) || [];

    // Then sort matrix tasks by their instance index within each task group
    const taskGroups = new Map<string, TaskRunKind[]>();
    
    // Group task runs by their pipeline task name
    sortedTaskRuns.forEach(taskRun => {
      const taskName = taskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask];
      
      if (taskName) {
        if (!taskGroups.has(taskName)) {
          taskGroups.set(taskName, []);
        }
        taskGroups.get(taskName).push(taskRun);
      } else {
        // TaskRun doesn't have a pipeline task name, skip it
      }
    });

    // Sort each group and flatten back to array
    const finalSortedTaskRuns: TaskRunKind[] = [];
    pipelineTaskNames?.forEach(taskName => {
      const group = taskGroups.get(taskName);
      if (group) {
        if (group.length > 1) {
          // Matrix task: sort by calculated matrix index
          group.sort((a, b) => {
            const pipelineTask = obj?.status?.pipelineSpec?.tasks?.find(t => t.name === taskName);
            if (!pipelineTask) return 0;
            
            // Get the calculated matrix index from each TaskRun
                  const aIndex = this.getMatrixInstanceIndex(a);
      const bIndex = this.getMatrixInstanceIndex(b);
            
            // Sort by matrix index (0, 1, 2, etc.)
            return aIndex - bIndex;
          });
        }
        finalSortedTaskRuns.push(...group);
      }
    });

    return finalSortedTaskRuns;
  };

  onNavSelect = (item: { itemId: number | string }) => {
    const { onActiveTaskChange } = this.props;
    const taskRunName = item.itemId as string;

    const { taskRuns } = this.props;
    const selectedTaskRun = taskRuns.find(tr => tr.metadata.name === taskRunName);
    


    if (selectedTaskRun) {
      // Get the pipeline task name
      const pipelineTaskName = selectedTaskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask];
      
      // Extract the index from TaskRun name (e.g., "clamav-scan-0" -> index 0)
      const indexMatch = taskRunName.match(/-(\d+)$/);
      const index = indexMatch ? parseInt(indexMatch[1], 10) : undefined;

      // Pass both the task name and index to the callback
      onActiveTaskChange?.(pipelineTaskName, index);
      
      this.setState({
        activeItem: taskRunName,
        navUntouched: false,
      });
    }
  };

  render() {
    const { className, obj, taskRuns } = this.props;
    const { activeItem } = this.state;

    const taskRunNames = this.getSortedTaskRun(taskRuns, [
      ...(obj?.status?.pipelineSpec?.tasks || []),
      ...(obj?.status?.pipelineSpec?.finally || []),
    ])?.map((t) => t.metadata.name);
    


    const logDetails = getPLRLogSnippet(obj, taskRuns) as ErrorDetailsWithStaticLog;
    const pipelineStatus = pipelineRunStatus(obj);
    
    const taskCount = taskRunNames.length;
    const downloadAllCallback =
      taskCount > 1
        ? getDownloadAllLogsCallback(
            taskRunNames,
            taskRuns,
            obj.metadata?.namespace,
            obj.metadata?.name,
          )
        : undefined;
    

    const activeTaskRun = taskRuns.find((taskRun) => taskRun.metadata.name === activeItem);
    const podName = activeTaskRun?.status?.podName;
    

    const resource: WatchK8sResource = taskCount > 0 &&
      podName && {
        name: podName,
        groupVersionKind: PodGroupVersionKind,
        namespace: obj.metadata.namespace,
        isList: false,
      };
    
    const waitingForPods = !!(activeItem && !resource);
    const taskName = activeTaskRun?.metadata?.labels?.[TektonResourceLabel.pipelineTask] || '-';
    const pipelineRunFinished = pipelineStatus !== runStatus.Running;

    const selectedItemRef = (item: HTMLSpanElement) => {
      if (item?.scrollIntoView) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    return (
      <div className={css('pipeline-run-logs', className)}>
        <div className="pipeline-run-logs__tasklist" data-test="logs-tasklist">
          {taskCount > 0 ? (
            <Nav onSelect={(_event, item) => this.onNavSelect(item)} theme="light">
              <NavList className="pipeline-run-logs__nav">
                {taskRunNames.map((taskRunName) => {
                  const taskRun = taskRuns.find((t) => t.metadata.name === taskRunName);
                  const currentTaskName =
                    taskRun?.metadata?.labels?.[TektonResourceLabel.pipelineTask] || '-';
                  


                  // Generate additional task info (matrix labels or displayName)
                  let additionalInfo: string | undefined;
                  if (taskRun) {
                    const pipelineTask = obj?.status?.pipelineSpec?.tasks?.find(t => t.name === currentTaskName);
                    
                    if (pipelineTask) {
                      // Check if this is a matrix task
                      const matrixTaskRuns = taskRuns.filter(tr => 
                        tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === currentTaskName
                      );
                      const isMatrixTask = matrixTaskRuns.length > 1;
                      

                      
                      if (isMatrixTask) {
                        // Matrix task: generate matrix label
                        const instanceIndex = matrixTaskRuns.findIndex(tr => tr.metadata.name === taskRunName);
                        if (instanceIndex >= 0) {
                          additionalInfo = createMatrixInstanceLabel(pipelineTask, taskRun, obj, instanceIndex);
                        }
                      } else {
                        // Regular task: check for displayName in childReferences
                        const childReferences = obj.status?.childReferences;
                        const childRef = (childReferences as Array<{ name: string; displayName?: string }>)?.find(
                          (ref) => ref.name === taskRun.metadata.name,
                        );

                        
                        if (childRef?.displayName) {
                          additionalInfo = childRef.displayName;
                        }
                      }
                    }
                  }

                  return (
                    <NavItem
                      key={taskRunName}
                      itemId={taskRunName}
                      isActive={activeItem === taskRunName}
                      className="pipeline-run-logs__navitem"
                    >
                      <span ref={activeItem === taskRunName ? selectedItemRef : undefined}>
                        <ColoredStatusIcon status={taskRunStatus(taskRun)} />
                        <span className="pipeline-run-logs__namespan">
                          {currentTaskName}
                          {additionalInfo && (
                            <div className="pipeline-run-logs__matrix-info">
                              <span className="pipeline-run-logs__matrix-label">
                                {additionalInfo}
                              </span>
                            </div>
                          )}
                        </span>
                      </span>
                    </NavItem>
                  );
                })}
              </NavList>
            </Nav>
          ) : (
            <div className="pipeline-run-logs__nav">{'No task runs found'}</div>
          )}
        </div>
        <div className="pipeline-run-logs__container">
          {activeItem && resource ? (
            <LogsWrapperComponent
              resource={resource}
              taskRun={activeTaskRun}
              downloadAllLabel={'Download all task logs'}
              onDownloadAll={downloadAllCallback}
            />
          ) : (
            <div className="pipeline-run-logs__log">
              <div className="pipeline-run-logs__logtext" data-test="task-logs-error">
                {waitingForPods && !pipelineRunFinished && `Waiting for ${taskName} task to start `}
                {!resource && pipelineRunFinished && !obj.status && 'No logs found'}
                {logDetails && (
                  <div className="pipeline-run-logs__logsnippet">{logDetails.staticMessage}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default PipelineRunLogs;
