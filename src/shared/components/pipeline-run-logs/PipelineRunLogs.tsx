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
    this.state = { activeItem: null, navUntouched: true };
  }

  componentDidMount() {
    this.initializeActiveTask();
  }

  componentDidUpdate(prevProps: PipelineRunLogsProps) {
    // Only update if the pipeline run or task runs have changed
    if (this.props.obj !== prevProps.obj || this.props.taskRuns !== prevProps.taskRuns) {
      this.initializeActiveTask();
    }
    
    // Also check if activeTask prop changed
    if (this.props.activeTask !== prevProps.activeTask) {
      this.initializeActiveTask();
    }
  }

  initializeActiveTask = () => {
    const { activeTask, taskRuns } = this.props;
    
    if (taskRuns.length === 0) {
      return; // No task runs available
    }

    if (activeTask) {
      // We have an active task from props, find the corresponding TaskRun
      const taskRun = taskRuns.find(tr => 
        tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === activeTask
      );
      
      if (taskRun) {
        this.setState({ activeItem: taskRun.metadata.name, navUntouched: false });
        return;
      }
    }

    // No active task specified, select the first available task
    if (this.state.navUntouched) {
      const sortedTaskRuns = this.getSortedTaskRun(taskRuns, [
        ...(this.props?.obj?.status?.pipelineSpec?.tasks || []),
        ...(this.props?.obj?.status?.pipelineSpec?.finally || []),
      ]);
      
      if (sortedTaskRuns.length > 0) {
        this.setState({ 
          activeItem: sortedTaskRuns[0].metadata.name, 
          navUntouched: false 
        });
      }
    }
  };



  getActiveTaskRun = (taskRuns: TaskRunKind[], activeTask: string): string => {
    if (!activeTask || taskRuns.length === 0) {
      return null;
    }

    // Find the task run that matches the active task
    const activeTaskRun = taskRuns.find((taskRun) => 
      taskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask] === activeTask
    );

    return activeTaskRun?.metadata.name || null;
  };

  getTaskRunName = (taskRunName: string) => {
    return this.props.taskRuns.find((taskRun) => taskRun.metadata.name === taskRunName)?.metadata
      ?.labels?.[TektonResourceLabel.pipelineTask];
  };



  getSortedTaskRun = (tRuns: TaskRunKind[], tasks: PipelineTask[]): TaskRunKind[] => {
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
    return (
      taskRuns?.sort(
        (c, d) =>
          pipelineTaskNames?.indexOf(c?.metadata?.labels?.[TektonResourceLabel.pipelineTask]) -
          pipelineTaskNames?.indexOf(d?.metadata?.labels?.[TektonResourceLabel.pipelineTask]),
      ) || []
    );
  };

  onNavSelect = (item: { itemId: number | string }) => {
    const taskRunName = item.itemId as string;

    // Simply update local state - no URL changes, no parent notifications
    this.setState({
      activeItem: taskRunName,
      navUntouched: false,
    });
  };

  render() {
    const { className, obj, taskRuns } = this.props;
    const { activeItem } = this.state;

    const taskRunNames = this.getSortedTaskRun(taskRuns, [
      ...(obj?.status?.pipelineSpec?.tasks || []),
      ...(obj?.status?.pipelineSpec?.finally || []),
    ])?.map((t) => t.metadata.name);

    // Ensure we always have an active task if tasks are available and none is selected
    if (taskRunNames.length > 0 && !activeItem && this.state.navUntouched) {
      // Use setTimeout to avoid setState during render
      setTimeout(() => {
        this.setState({ 
          activeItem: taskRunNames[0], 
          navUntouched: false 
        });
      }, 0);
    }



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
                      <span>
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
                {!activeItem && taskCount > 0 && 'Select a task to view its logs'}
                {logDetails && !activeItem && (
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
