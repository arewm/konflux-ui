import React from 'react';
import { Link } from 'react-router-dom';
import {
  DrawerActions,
  DrawerCloseButton,
  DrawerHead,
  DrawerPanelBody,
  Tab,
  Tabs,
} from '@patternfly/react-core';
import { ElementModel, GraphElement } from '@patternfly/react-topology';
import { PipelineRunLabel } from '../../../../consts/pipelinerun';
import { TASKRUN_DETAILS_PATH } from '../../../../routes/paths';
import { useNamespace } from '../../../../shared/providers/Namespace';
import { TektonResourceLabel , PipelineRunKind, TaskRunKind } from '../../../../types';
import { StatusIconWithTextLabel } from '../../../StatusIcon/StatusIcon';
import TaskRunLogs from '../../../TaskRuns/TaskRunLogs';
import { PipelineRunNodeData } from '../visualization/types';
import { createMatrixInstanceLabel } from '../visualization/utils/pipelinerun-graph-utils';
import TaskRunDetails from './TaskRunDetails';

import './TaskRunPanel.scss';

type Props = {
  onClose: () => void;
  taskNode: GraphElement<ElementModel, PipelineRunNodeData>;
  pipelineRun: PipelineRunKind;
  taskRuns: TaskRunKind[];
};

const TaskRunPanel: React.FC<React.PropsWithChildren<Props>> = ({ 
  taskNode, 
  onClose, 
  pipelineRun, 
  taskRuns 
}) => {
  const task = taskNode.getData().task;
  const taskRun = taskNode.getData().taskRun;
  const { status } = taskNode.getData();
  const namespace = useNamespace();
  const applicationName = taskRun?.metadata?.labels[PipelineRunLabel.APPLICATION];

  // Get the original task name (for matrix tasks, use originalName; for regular tasks, use name)
  const originalTaskName = React.useMemo(() => {
    const matrixTask = task as any;
    return matrixTask.isMatrix && matrixTask.originalName ? matrixTask.originalName : task.name;
  }, [task]);

  // Check if we have a displayName from childReferences (same logic as logs page)
  const displayName = React.useMemo(() => {
    if (taskRun && pipelineRun?.status?.childReferences) {
      const childRef = (pipelineRun.status.childReferences as any[]).find(
        (ref: any) => ref.name === taskRun.metadata?.name
      );
      if (childRef?.displayName) {
        return childRef.displayName;
      }
    }
    
    // If no displayName from childReferences, generate matrix information for matrix tasks
    if (taskRun && pipelineRun?.status?.pipelineSpec?.tasks) {
      const currentTaskName = taskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask];
      
      if (currentTaskName) {
        const pipelineTask = pipelineRun.status.pipelineSpec.tasks.find(t => t.name === currentTaskName);
        
        if (pipelineTask) {
          // Check if this is a matrix task
          const matrixTaskRuns = taskRuns.filter(tr => 
            tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] === currentTaskName
          );
          const isMatrixTask = matrixTaskRuns.length > 1;
          
          if (isMatrixTask) {
            // Matrix task: generate matrix label using the same logic as logs page
            const instanceIndex = matrixTaskRuns.findIndex(tr => tr.metadata.name === taskRun.metadata.name);
            
            if (instanceIndex >= 0) {
              return createMatrixInstanceLabel(pipelineTask, taskRun, pipelineRun, instanceIndex);
            }
          }
        }
      }
    }
    
    return undefined;
  }, [taskRun, pipelineRun, taskRuns]);

  return (
    <>
      <div className="task-run-panel__head">
        <DrawerHead data-id="task-run-panel-head-id">
          <span>
            {applicationName ? (
              <Link
                to={TASKRUN_DETAILS_PATH.createPath({
                  applicationName,
                  workspaceName: namespace,
                  taskRunName: taskRun.metadata?.name,
                })}
              >
                {originalTaskName}
              </Link>
            ) : (
              originalTaskName
            )}{' '}
            <StatusIconWithTextLabel status={status} />
          </span>
          <DrawerActions>
            <DrawerCloseButton onClick={onClose} />
          </DrawerActions>
        </DrawerHead>
      </div>

      {/* Show displayName if available (same styling as logs page) */}
      {displayName && (
        <div className="task-run-panel__display-name" style={{ 
          padding: '0.5rem 1rem', 
          color: 'var(--pf-v5-global--Color--200)',
          fontSize: 'var(--pf-v5-global--FontSize--sm)',
          fontStyle: 'italic',
          opacity: 0.8
        }}>
          {displayName}
        </div>
      )}

      <div className="task-run-panel__tabs">
        <Tabs defaultActiveKey="details" unmountOnExit className="">
          <Tab title="Details" eventKey="details">
            <DrawerPanelBody>
              <TaskRunDetails taskRun={taskRun} status={status} />
            </DrawerPanelBody>
          </Tab>
          <Tab title="Logs" eventKey="logs">
            <DrawerPanelBody style={{ height: '100%' }}>
              <TaskRunLogs
                taskRun={taskRun}
                namespace={taskNode.getData().namespace}
                status={status}
              />
            </DrawerPanelBody>
          </Tab>
        </Tabs>
      </div>
    </>
  );
};

export default TaskRunPanel;
