import {
  TaskRunKind,
  PipelineRunKind,
  PipelineKind,
  TektonResourceLabel,
} from '../../../../../../types';
import { MatrixPipelineTaskWithStatus } from '../../types';
import { appendStatus } from '../pipelinerun-graph-utils';

describe('Matrix DisplayName Support - Basic Tests', () => {
  const mockPipeline: PipelineKind = {
    apiVersion: 'tekton.dev/v1',
    kind: 'Pipeline',
    metadata: {
      name: 'test-pipeline',
      namespace: 'test-namespace',
    },
    spec: {
      tasks: [
        {
          name: 'build-task',
          taskRef: { name: 'build-task' },
        },
      ],
    },
  };

  const mockPipelineRun: PipelineRunKind = {
    apiVersion: 'tekton.dev/v1',
    kind: 'PipelineRun',
    metadata: {
      name: 'test-pipeline-run',
      namespace: 'test-namespace',
    },
    spec: {
      pipelineRef: { name: 'test-pipeline' },
    },
    status: {
      pipelineSpec: {
        tasks: [
          {
            name: 'build-task',
            taskRef: { name: 'build-task' },
          },
        ],
      },
      childReferences: [
        {
          apiVersion: 'tekton.dev/v1',
          kind: 'TaskRun',
          name: 'build-task-matrix-linux-x86-64',
          pipelineTaskName: 'build-task',
          displayName: 'Build for Linux x86_64 Platform',
        },
        {
          apiVersion: 'tekton.dev/v1',
          kind: 'TaskRun',
          name: 'build-task-matrix-linux-arm64',
          pipelineTaskName: 'build-task',
          displayName: 'Build for Linux ARM64 Platform',
        },
      ],
    },
  };

  const createMockTaskRun = (name: string, matrixValue: string): TaskRunKind => ({
    apiVersion: 'tekton.dev/v1',
    kind: 'TaskRun',
    metadata: {
      name,
      namespace: 'test-namespace',
      labels: {
        [TektonResourceLabel.pipelineTask]: 'build-task',
      },
      annotations: {
        'build.appstudio.redhat.com/target-platform': matrixValue,
      },
    },
    spec: {
      taskRef: { name: 'build-task' },
    },
    status: {
      conditions: [
        {
          type: 'Succeeded',
          status: 'True',
          reason: 'Succeeded',
        },
      ],
    },
  });

  describe('Matrix Task Detection with DisplayName', () => {
    it('should detect matrix tasks and use displayName when available', () => {
      // Create two TaskRuns with the same pipeline task name (required for matrix detection)
      const taskRuns = [
        createMockTaskRun('build-task-matrix-linux-x86-64', 'linux-x86_64'),
        createMockTaskRun('build-task-matrix-linux-arm64', 'linux-arm64'),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      // Should create 2 matrix tasks
      expect(result).toHaveLength(2);

      // Check that each task has matrix properties
      result.forEach((task: MatrixPipelineTaskWithStatus) => {
        expect(task.isMatrix).toBe(true);
        expect(task.matrixParameter).toBe('build.appstudio.redhat.com/target-platform');
        expect(task.originalName).toBe('build-task');
      });

      // Find the specific tasks
      const linuxX86Task = result.find(
        (task) => (task as MatrixPipelineTaskWithStatus).matrixValue === 'linux-x86_64',
      );
      expect(linuxX86Task).toBeDefined();
      expect((linuxX86Task as MatrixPipelineTaskWithStatus)?.matrixDisplayName).toBe(
        'Build for Linux x86_64 Platform',
      );

      const linuxArmTask = result.find(
        (task) => (task as MatrixPipelineTaskWithStatus).matrixValue === 'linux-arm64',
      );
      expect(linuxArmTask).toBeDefined();
      expect((linuxArmTask as MatrixPipelineTaskWithStatus)?.matrixDisplayName).toBe(
        'Build for Linux ARM64 Platform',
      );
    });

    it('should fallback to parameter value when displayName is not available', () => {
      const pipelineRunWithoutDisplayName: PipelineRunKind = {
        ...mockPipelineRun,
        status: {
          ...mockPipelineRun.status,
          childReferences: [
            {
              apiVersion: 'tekton.dev/v1',
              kind: 'TaskRun',
              name: 'build-task-matrix-linux-x86-64',
              pipelineTaskName: 'build-task',
              // No displayName field
            },
            {
              apiVersion: 'tekton.dev/v1',
              kind: 'TaskRun',
              name: 'build-task-matrix-linux-arm64',
              pipelineTaskName: 'build-task',
              // No displayName field
            },
          ],
        },
      };

      const taskRuns = [
        createMockTaskRun('build-task-matrix-linux-x86-64', 'linux-x86_64'),
        createMockTaskRun('build-task-matrix-linux-arm64', 'linux-arm64'),
      ];

      const result = appendStatus(mockPipeline, pipelineRunWithoutDisplayName, taskRuns);

      expect(result).toHaveLength(2);

      const linuxX86Task = result.find(
        (task) => (task as MatrixPipelineTaskWithStatus).matrixValue === 'linux-x86_64',
      );
      expect(linuxX86Task).toBeDefined();
      expect((linuxX86Task as MatrixPipelineTaskWithStatus)?.matrixDisplayName).toBe(
        'linux/x86_64',
      ); // TARGET_PLATFORM conversion
      expect((linuxX86Task as MatrixPipelineTaskWithStatus)?.matrixPlatform).toBe('linux/x86_64');
    });
  });

  describe('Security Sanitization', () => {
    it('should sanitize displayName with HTML tags', () => {
      const maliciousPipelineRun: PipelineRunKind = {
        ...mockPipelineRun,
        status: {
          ...mockPipelineRun.status,
          childReferences: [
            {
              apiVersion: 'tekton.dev/v1',
              kind: 'TaskRun',
              name: 'build-task-matrix-linux-x86-64',
              pipelineTaskName: 'build-task',
              displayName: '<script>alert("xss")</script>Build Task',
            },
            {
              apiVersion: 'tekton.dev/v1',
              kind: 'TaskRun',
              name: 'build-task-matrix-linux-arm64',
              pipelineTaskName: 'build-task',
              displayName: 'Safe Build Task',
            },
          ],
        },
      };

      const taskRuns = [
        createMockTaskRun('build-task-matrix-linux-x86-64', 'linux-x86_64'),
        createMockTaskRun('build-task-matrix-linux-arm64', 'linux-arm64'),
      ];

      const result = appendStatus(mockPipeline, maliciousPipelineRun, taskRuns);

      expect(result).toHaveLength(2);

      const maliciousTask = result.find(
        (task) => (task as MatrixPipelineTaskWithStatus).matrixValue === 'linux-x86_64',
      );
      expect(maliciousTask).toBeDefined();
      expect((maliciousTask as MatrixPipelineTaskWithStatus)?.matrixDisplayName).toBe(
        'alert("xss")Build Task',
      );
      expect((maliciousTask as MatrixPipelineTaskWithStatus)?.matrixDisplayName).not.toContain(
        '<script>',
      );
      expect((maliciousTask as MatrixPipelineTaskWithStatus)?.matrixDisplayName).not.toContain(
        '</script>',
      );
    });

    it('should limit displayName length to 100 characters', () => {
      const longDisplayName = 'A'.repeat(150);
      const longPipelineRun: PipelineRunKind = {
        ...mockPipelineRun,
        status: {
          ...mockPipelineRun.status,
          childReferences: [
            {
              apiVersion: 'tekton.dev/v1',
              kind: 'TaskRun',
              name: 'build-task-matrix-linux-x86-64',
              pipelineTaskName: 'build-task',
              displayName: longDisplayName,
            },
            {
              apiVersion: 'tekton.dev/v1',
              kind: 'TaskRun',
              name: 'build-task-matrix-linux-arm64',
              pipelineTaskName: 'build-task',
              displayName: 'Normal Task',
            },
          ],
        },
      };

      const taskRuns = [
        createMockTaskRun('build-task-matrix-linux-x86-64', 'linux-x86_64'),
        createMockTaskRun('build-task-matrix-linux-arm64', 'linux-arm64'),
      ];

      const result = appendStatus(mockPipeline, longPipelineRun, taskRuns);

      expect(result).toHaveLength(2);

      const longTask = result.find(
        (task) => (task as MatrixPipelineTaskWithStatus).matrixValue === 'linux-x86_64',
      );
      expect(longTask).toBeDefined();
      expect((longTask as MatrixPipelineTaskWithStatus)?.matrixDisplayName).toHaveLength(100);
      expect((longTask as MatrixPipelineTaskWithStatus)?.matrixDisplayName).toBe('A'.repeat(100));
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain TARGET_PLATFORM legacy behavior', () => {
      const taskRuns = [
        createMockTaskRun('build-task-matrix-linux-x86-64', 'linux-x86_64'),
        createMockTaskRun('build-task-matrix-linux-arm64', 'linux-arm64'),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      expect(result).toHaveLength(2);

      result.forEach((task: MatrixPipelineTaskWithStatus) => {
        expect(task.matrixParameter).toBe('build.appstudio.redhat.com/target-platform');
        expect(task.isMatrix).toBe(true);
        expect(task.originalName).toBe('build-task');
        // Should have both new and legacy fields
        expect(task.matrixDisplayName).toBeDefined();
        expect(task.matrixPlatform).toBeDefined();
        expect(task.matrixPlatform).toBe(task.matrixDisplayName); // Legacy field should match
      });
    });
  });
});
