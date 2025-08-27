/**
 * Matrix Edge Case Tests
 *
 * Tests for edge cases and error scenarios
 * Separated to reduce memory usage per test file
 */

import { PipelineRunKind, TaskRunKind } from '../../../../../../types';
import { MatrixPipelineTaskWithStatus } from '../../types';
import { appendStatus, getPipelineFromPipelineRun } from '../pipelinerun-graph-utils';

// Simplified mock data generators
const createMockPipelineRun = (overrides: Partial<PipelineRunKind> = {}): PipelineRunKind => ({
  apiVersion: 'tekton.dev/v1',
  kind: 'PipelineRun',
  metadata: {
    name: 'test-pipeline-run',
    namespace: 'test-namespace',
    labels: {
      'tekton.dev/pipeline': 'test-pipeline',
    },
  },
  spec: {
    pipelineRef: { name: 'test-pipeline' },
  },
  status: {
    conditions: [{ type: 'Succeeded', status: 'True', reason: 'Completed' }],
    pipelineSpec: {
      tasks: [{ name: 'build', taskRef: { name: 'build-task' } }],
    },
    childReferences: [],
  },
  ...overrides,
});

const createMockTaskRun = (
  name: string,
  pipelineTaskName: string,
  matrixLabels: Record<string, string> = {},
  overrides: Partial<TaskRunKind> = {},
): TaskRunKind => ({
  apiVersion: 'tekton.dev/v1',
  kind: 'TaskRun',
  metadata: {
    name,
    namespace: 'test-namespace',
    labels: {
      'tekton.dev/pipelineTask': pipelineTaskName,
    },
    annotations: {
      ...matrixLabels,
    },
  },
  spec: {
    taskRef: { name: `${pipelineTaskName}-task` },
  },
  status: {
    conditions: [{ type: 'Succeeded', status: 'True', reason: 'Completed' }],
    startTime: '2023-01-01T10:00:00Z',
    completionTime: '2023-01-01T10:05:00Z',
    steps: [
      {
        name: 'main',
        container: 'main-container',
        terminated: {
          reason: 'Completed',
          startedAt: '2023-01-01T10:00:00Z',
          finishedAt: '2023-01-01T10:05:00Z',
          containerID: 'container-123',
          exitCode: 0,
        },
      },
    ],
  },
  ...overrides,
});

describe('Matrix Edge Cases', () => {
  it('should handle missing childReferences gracefully', () => {
    const pipelineRun = createMockPipelineRun({
      status: {
        childReferences: [], // No childReferences
      },
    });

    const taskRuns = [
      createMockTaskRun('build-linux-x86-64', 'build', {
        'build.appstudio.redhat.com/target-platform': 'linux-x86_64',
      }),
    ];

    const pipeline = getPipelineFromPipelineRun(pipelineRun);
    const result = appendStatus(pipeline, pipelineRun, taskRuns);

    expect(result).toHaveLength(1);
    // Should still work even without childReferences
  });

  it('should handle null pipeline gracefully', () => {
    const pipelineRun = createMockPipelineRun();
    const taskRuns = [createMockTaskRun('build-linux-x86-64', 'build')];

    const result = appendStatus(null, pipelineRun, taskRuns);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle security sanitization of display names', () => {
    const pipelineRun = createMockPipelineRun({
      status: {
        childReferences: [
          {
            apiVersion: 'tekton.dev/v1',
            kind: 'TaskRun',
            name: 'build-malicious',
            pipelineTaskName: 'build',
            displayName: '<script>alert("xss")</script>',
          },
        ],
      },
    });

    const taskRuns = [createMockTaskRun('build-malicious', 'build')];

    const pipeline = getPipelineFromPipelineRun(pipelineRun);
    const result = appendStatus(pipeline, pipelineRun, taskRuns);

    expect(result).toHaveLength(1);
    const task = result[0] as MatrixPipelineTaskWithStatus;
    expect(task.matrixDisplayName).toBe('alert("xss")'); // Sanitized
  });

  it('should handle long display names with length limiting', () => {
    const longDisplayName = 'A'.repeat(200); // Very long name

    const pipelineRun = createMockPipelineRun({
      status: {
        childReferences: [
          {
            apiVersion: 'tekton.dev/v1',
            kind: 'TaskRun',
            name: 'build-long-name',
            pipelineTaskName: 'build',
            displayName: longDisplayName,
          },
        ],
      },
    });

    const taskRuns = [createMockTaskRun('build-long-name', 'build')];

    const pipeline = getPipelineFromPipelineRun(pipelineRun);
    const result = appendStatus(pipeline, pipelineRun, taskRuns);

    expect(result).toHaveLength(1);
    const task = result[0] as MatrixPipelineTaskWithStatus;
    expect(task.matrixDisplayName).toBeDefined();
    expect(task.matrixDisplayName.length).toBeLessThanOrEqual(200);
  });
});
