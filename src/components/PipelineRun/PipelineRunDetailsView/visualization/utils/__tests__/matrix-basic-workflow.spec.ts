/**
 * Basic Matrix Workflow Tests
 *
 * Focused tests for core matrix functionality without complex scenarios
 * This reduces memory usage by testing fewer cases at once
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
      tasks: [
        { name: 'build', taskRef: { name: 'build-task' } },
        { name: 'test', taskRef: { name: 'test-task' }, runAfter: ['build'] },
      ],
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

describe('Matrix Basic Workflow', () => {
  it('should handle basic multi-platform build matrix', () => {
    const pipelineRun = createMockPipelineRun({
      status: {
        pipelineSpec: {
          tasks: [
            { name: 'build', taskRef: { name: 'build-task' } },
            { name: 'test', taskRef: { name: 'test-task' }, runAfter: ['build'] },
          ],
        },
        childReferences: [
          {
            apiVersion: 'tekton.dev/v1',
            kind: 'TaskRun',
            name: 'build-linux-x86-64',
            pipelineTaskName: 'build',
            displayName: 'Build for Linux x86_64',
          },
          {
            apiVersion: 'tekton.dev/v1',
            kind: 'TaskRun',
            name: 'build-linux-arm64',
            pipelineTaskName: 'build',
            displayName: 'Build for Linux ARM64',
          },
        ],
      },
    });

    const taskRuns = [
      createMockTaskRun('build-linux-x86-64', 'build', {
        'build.appstudio.redhat.com/target-platform': 'linux-x86_64',
      }),
      createMockTaskRun('build-linux-arm64', 'build', {
        'build.appstudio.redhat.com/target-platform': 'linux-arm64',
      }),
    ];

    const pipeline = getPipelineFromPipelineRun(pipelineRun);
    const result = appendStatus(pipeline, pipelineRun, taskRuns);

    expect(result).toHaveLength(2);

    const buildTasks = result.filter((task) => task.name.startsWith('build-'));
    expect(buildTasks).toHaveLength(2);

    buildTasks.forEach((task) => {
      expect((task as MatrixPipelineTaskWithStatus).isMatrix).toBe(true);
      expect((task as MatrixPipelineTaskWithStatus).originalName).toBe('build');
    });
  });

  it('should handle mixed matrix and regular tasks', () => {
    const pipelineRun = createMockPipelineRun({
      status: {
        pipelineSpec: {
          tasks: [
            { name: 'build', taskRef: { name: 'build-task' } },
            { name: 'test', taskRef: { name: 'test-task' }, runAfter: ['build'] },
          ],
        },
        childReferences: [
          {
            apiVersion: 'tekton.dev/v1',
            kind: 'TaskRun',
            name: 'build-linux-x86-64',
            pipelineTaskName: 'build',
            displayName: 'Build for Linux x86_64',
          },
        ],
      },
    });

    const taskRuns = [
      createMockTaskRun('build-linux-x86-64', 'build', {
        'build.appstudio.redhat.com/target-platform': 'linux-x86_64',
      }),
      createMockTaskRun('test-default', 'test'),
    ];

    const pipeline = getPipelineFromPipelineRun(pipelineRun);
    const result = appendStatus(pipeline, pipelineRun, taskRuns);

    expect(result).toHaveLength(2);

    const buildTask = result.find((task) => task.name.startsWith('build-'));
    expect((buildTask as MatrixPipelineTaskWithStatus).isMatrix).toBe(true);

    const testTask = result.find((task) => task.name === 'test');
    expect((testTask as MatrixPipelineTaskWithStatus).isMatrix).toBeUndefined();
  });
});
