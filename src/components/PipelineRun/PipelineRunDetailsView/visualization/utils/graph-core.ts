/**
 * Core Graph Utilities for PipelineRun Visualization
 * 
 * Contains essential functions for graph processing
 */

import { PipelineKind, PipelineRunKind } from '../../../../../types';

// Core utility functions
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
    },
    spec: pipelineSpec,
  };
};

// Export types for use in other modules
export type {
  PipelineRunNodeData,
  PipelineRunNodeModel,
  PipelineRunNodeType,
  PipelineTaskStatus,
  PipelineTaskWithStatus,
  StepStatus,
} from '../types';
