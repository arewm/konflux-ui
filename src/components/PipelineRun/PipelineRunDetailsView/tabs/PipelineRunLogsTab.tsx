import * as React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Bullseye, Spinner } from '@patternfly/react-core';
import { useNamespace } from '~/shared/providers/Namespace';
import { usePipelineRun } from '../../../../hooks/usePipelineRuns';
import { useSearchParam } from '../../../../hooks/useSearchParam';
import { useTaskRuns } from '../../../../hooks/useTaskRuns';
import { HttpError } from '../../../../k8s/error';
import { RouterParams } from '../../../../routes/utils';
import { PipelineRunLogs } from '../../../../shared';
import ErrorEmptyState from '../../../../shared/components/empty-state/ErrorEmptyState';

const PipelineRunLogsTab: React.FC = () => {
  const pipelineRunName = useParams<RouterParams>().pipelineRunName;
  const namespace = useNamespace();
  const [pipelineRun, loaded, error] = usePipelineRun(namespace, pipelineRunName);
  const [taskRuns, taskRunsLoaded, taskRunError] = useTaskRuns(namespace, pipelineRunName);
  const [activeTask] = useSearchParam('task', null);
  // const [activeIndex] = useSearchParam('index', null); // Unused for now
  const [searchParams, setSearchParams] = useSearchParams();



  const handleActiveTaskChange = React.useCallback(
    (taskName: string, matrixIndex?: number) => {
      if (taskName) {
        // Create a single URLSearchParams update to avoid race conditions
        const newSearchParams = new URLSearchParams(searchParams);
        
        // Update task parameter
        newSearchParams.set('task', taskName);
        
        // Update or clear index parameter
        if (matrixIndex !== undefined) {
          newSearchParams.set('index', matrixIndex.toString());
        } else {
          newSearchParams.delete('index');
        }
        
        // Apply both changes atomically
        setSearchParams(newSearchParams, { replace: true });
      } else {
        // Clear both parameters atomically
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete('task');
        newSearchParams.delete('index');
        setSearchParams(newSearchParams, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const loadError = error || taskRunError;
  if (loadError) {
    const httpError = HttpError.fromCode((loadError as { code: number }).code);
    return (
      <ErrorEmptyState
        httpError={httpError}
        title={`Unable to load pipeline run ${pipelineRunName}`}
        body={httpError.message}
      />
    );
  }

  if (!(loaded && taskRunsLoaded)) {
    return (
      <Bullseye>
        <Spinner />
      </Bullseye>
    );
  }

  return (
    <PipelineRunLogs
      className="pf-v5-u-pt-md"
      obj={pipelineRun}
      taskRuns={taskRuns}
      activeTask={activeTask}
      onActiveTaskChange={handleActiveTaskChange}
    />
  );
};

export default PipelineRunLogsTab;
