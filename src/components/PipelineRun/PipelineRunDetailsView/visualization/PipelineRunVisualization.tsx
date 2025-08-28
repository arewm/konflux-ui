import React from 'react';
import { Node } from '@patternfly/react-topology';
import { PipelineRunKind, TaskRunKind } from '../../../../types';
import { layoutFactory, VisualizationFactory } from '../../../topology/factories';
import GraphErrorState from '../../../topology/factories/GraphErrorState';
import { pipelineRunComponentFactory } from '../factories';
import PipelineRunSidePanel from '../PipelineRunSidePanel';
import { getPipelineRunDataModel, scrollNodeIntoView } from './utils/pipelinerun-graph-utils';

import './PipelineRunVisualization.scss';

const PipelineRunVisualization: React.FC<{
  pipelineRun: PipelineRunKind;
  error: unknown;
  taskRuns: TaskRunKind[];
}> = ({ pipelineRun, error, taskRuns }) => {
  const nodeRef = React.useRef<HTMLDivElement>();

  const model = React.useMemo(() => {
    return getPipelineRunDataModel(pipelineRun, taskRuns);
  }, [pipelineRun, taskRuns]);

  const scrollIntoView = React.useCallback(
    (node: Node) => {
      if (nodeRef.current) {
        scrollNodeIntoView(node, nodeRef.current);
      }
    },
    [nodeRef],
  );

  if (error) {
    return <GraphErrorState errors={[error]} />;
  }
  if (!model && !error) {
    // Check if the issue is missing pipeline spec
    if (!pipelineRun?.status?.pipelineSpec && !pipelineRun?.spec?.pipelineSpec) {
      return (
        <div className="pipelinerun-graph-error" data-test="pipelinerun-graph-error">
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <h3>Pipeline Visualization Unavailable</h3>
            <p>
              The pipeline specification is missing from this pipeline run. This commonly happens when:
            </p>
            <ul style={{ textAlign: 'left', display: 'inline-block' }}>
              <li>The pipeline run was created without embedding the pipeline spec</li>
              <li>The pipeline was deleted after the run was created</li>
              <li>There was an issue during pipeline run creation</li>
            </ul>
            <p>
              <strong>Available Information:</strong> {taskRuns?.length || 0} task runs are available, 
              but the pipeline structure cannot be determined without the pipeline specification.
            </p>
          </div>
        </div>
      );
    }
    return null;
  }
  return (
    <div ref={nodeRef} className="pipelinerun-graph" data-test="pipelinerun-graph">
      <VisualizationFactory
        componentFactory={pipelineRunComponentFactory}
        layoutFactory={layoutFactory}
        model={model}
      >
        <PipelineRunSidePanel scrollIntoView={scrollIntoView} />
      </VisualizationFactory>
    </div>
  );
};
export default PipelineRunVisualization;
