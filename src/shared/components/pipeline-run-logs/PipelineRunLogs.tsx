import * as React from 'react';
import { Nav, NavItem, NavList } from '@patternfly/react-core';
import { css } from '@patternfly/react-styles';
import get from 'lodash/get';
import { ColoredStatusIcon } from '../../../components/topology/StatusIcon';
import { PodGroupVersionKind } from '../../../models/pod';
import { PipelineRunKind, PipelineTask, TaskRunKind, TektonResourceLabel } from '../../../types';
import { WatchK8sResource } from '../../../types/k8s';

import { pipelineRunStatus, runStatus, taskRunStatus } from '../../../utils/pipeline-utils';
import { createMatrixInstanceLabel } from '../../../components/PipelineRun/PipelineRunDetailsView/visualization/utils/pipelinerun-graph-utils';
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
    const { activeTask, taskRuns } = this.props;
    if (activeTask && taskRuns.length > 0) {
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
        }
      } else {
        // No index parameter, find the first TaskRun for this task
        const firstTaskRun = taskRuns.find(tr => 
          tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === taskName
        );
        if (firstTaskRun) {
          this.setState({ activeItem: firstTaskRun.metadata.name });
        }
      }
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps: PipelineRunLogsProps) {
    if (this.props.obj !== nextProps.obj || this.props.taskRuns !== nextProps.taskRuns) {
      const { activeTask, taskRuns } = this.props;
      const sortedTaskRuns = this.getSortedTaskRun(taskRuns, [
        ...(this.props?.obj?.status?.pipelineSpec?.tasks || []),
        ...(this.props?.obj?.status?.pipelineSpec?.finally || []),
      ]);
      const activeItem = this.getActiveTaskRun(sortedTaskRuns, activeTask);
      this.state.navUntouched && this.setState({ activeItem });
    }
  }

  getActiveTaskRun = (taskRuns: TaskRunKind[], activeTask: string): string => {
    const activeTaskRun = activeTask
      ? taskRuns.find((taskRun) => taskRun.metadata.name.includes(activeTask))
      : taskRuns.find((taskRun) => taskRunStatus(taskRun) === runStatus.Failed) ||
        taskRuns[taskRuns.length - 1];

    return activeTaskRun?.metadata.name;
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
