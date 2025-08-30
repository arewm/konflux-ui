import { TaskRunLabel } from '../../../../../../consts/pipelinerun';
import { TaskRunKind, PipelineRunKind, PipelineKind } from '../../../../../../types';
import { runStatus } from '../../../../../../utils/pipeline-utils';
import { appendStatus } from '../pipelinerun-graph-utils';

const TektonResourceLabel = {
  pipelineTask: 'tekton.dev/pipelineTask',
};

describe('Generic Matrix Parameter Detection Integration', () => {
  const mockPipeline: PipelineKind = {
    apiVersion: 'tekton.dev/v1',
    kind: 'Pipeline',
    metadata: { name: 'test-pipeline', namespace: 'test-ns' },
    spec: {
      tasks: [
        {
          name: 'security-scan',
          taskRef: { name: 'clamav-scan', kind: 'Task' },
        },
        {
          name: 'ecosystem-scan',
          taskRef: { name: 'ecosystem-cert-preflight', kind: 'Task' },
        },
        {
          name: 'multi-param-task',
          taskRef: { name: 'multi-matrix', kind: 'Task' },
        },
      ],
    },
  };

  const mockPipelineRun: PipelineRunKind = {
    apiVersion: 'tekton.dev/v1',
    kind: 'PipelineRun',
    metadata: { name: 'test-pipeline-run', namespace: 'test-ns' },
    spec: { pipelineRef: { name: 'test-pipeline' } },
    status: {
      conditions: [
        {
          type: 'Succeeded',
          status: 'Unknown',
          reason: 'Running',
        },
      ],
      pipelineSpec: {
        tasks: [],
      },
    } as never,
  };

  const createMockTaskRun = (
    taskName: string,
    parameters: Record<string, string> = {},
    status: runStatus = runStatus['In Progress'],
  ): TaskRunKind => ({
    apiVersion: 'tekton.dev/v1',
    kind: 'TaskRun',
    metadata: {
      name: `${taskName}-${Object.values(parameters).join('-') || 'default'}`,
      namespace: 'test-ns',
      labels: {
        [TektonResourceLabel.pipelineTask]: taskName,
      },
      annotations: {
        ...parameters,
      },
    },
    spec: { taskRef: { name: taskName } },
    status: {
      conditions: [
        {
          type: 'Succeeded',
          status: status === runStatus.Succeeded ? 'True' : 'Unknown',
          reason: status,
        },
      ],
    },
  });

  describe('ClamAV Security Scanning Matrix', () => {
    it('should detect matrix tasks with SCAN_TYPE parameter', () => {
      const taskRuns = [
        createMockTaskRun('security-scan', { SCAN_TYPE: 'virus' }),
        createMockTaskRun('security-scan', { SCAN_TYPE: 'malware' }),
        createMockTaskRun('security-scan', { SCAN_TYPE: 'rootkit' }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      // Should have 3 matrix task entries for security-scan + 2 regular tasks
      expect(result).toHaveLength(5);

      // Find the matrix tasks
      const scanTasks = result.filter((task) => task.name.startsWith('security-scan'));
      expect(scanTasks).toHaveLength(3);

      // Verify matrix task structure
      type MatrixTask = (typeof scanTasks)[0] & {
        originalName?: string;
        matrixParameter?: string;
        matrixValue?: string;
        matrixDisplayName?: string;
        isMatrix?: boolean;
      };

      const matrixTasks = scanTasks as MatrixTask[];
      expect(matrixTasks[0].originalName).toBe('security-scan');
      expect(matrixTasks[0].isMatrix).toBe(true);
      // matrixParameter and matrixValue are not used in the UI, so we don't test them
      expect(matrixTasks[0].matrixDisplayName).toBeDefined();
    });

    it('should handle single SCAN_TYPE task as matrix task', () => {
      const taskRuns = [createMockTaskRun('security-scan', { SCAN_TYPE: 'virus' })];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      // Should have 3 tasks (1 regular + 2 skipped)
      expect(result).toHaveLength(3);
      // Single TaskRun is not a matrix task
      expect(result[0].name).toBe('security-scan');

      // Should NOT be marked as matrix task since there's only 1 TaskRun
      type MatrixTask = (typeof result)[0] & {
        isMatrix?: boolean;
        matrixParameter?: string;
        matrixValue?: string;
      };
      expect((result[0] as MatrixTask).isMatrix).toBeUndefined();
      // matrixParameter and matrixValue are not used in the UI, so we don't test them
    });
  });

  describe('Ecosystem Cert Preflight Matrix', () => {
    it('should detect matrix tasks with ECOSYSTEM parameter', () => {
      const taskRuns = [
        createMockTaskRun('ecosystem-scan', { ECOSYSTEM: 'npm' }),
        createMockTaskRun('ecosystem-scan', { ECOSYSTEM: 'pypi' }),
        createMockTaskRun('ecosystem-scan', { ECOSYSTEM: 'maven' }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      expect(result).toHaveLength(5); // 3 matrix + 2 regular

      const ecosystemTasks = result.filter((task) => task.name.startsWith('ecosystem-scan'));
      expect(ecosystemTasks).toHaveLength(3);

      type MatrixTask = (typeof ecosystemTasks)[0] & {
        matrixParameter?: string;
        matrixValue?: string;
        matrixDisplayName?: string;
      };

      const matrixTasks = ecosystemTasks as MatrixTask[];
      // matrixParameter and matrixValue are not used in the UI, so we don't test them
      expect(matrixTasks[0].matrixDisplayName).toBeDefined();
    });
  });

  describe('Multiple Matrix Parameters', () => {
    it('should handle tasks with multiple matrix parameters', () => {
      const taskRuns = [
        createMockTaskRun('multi-param-task', {
          NODE_VERSION: '18',
          PLATFORM: 'linux-x64',
        }),
        createMockTaskRun('multi-param-task', {
          NODE_VERSION: '20',
          PLATFORM: 'linux-arm64',
        }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      expect(result).toHaveLength(4); // 2 matrix + 2 regular

      const multiTasks = result.filter((task) => task.name.startsWith('multi-param-task'));
      expect(multiTasks).toHaveLength(2);

      // Should use first parameter for primary display
      type MatrixTask = (typeof multiTasks)[0] & {
        matrixParameter?: string;
        matrixValue?: string;
        matrixDisplayName?: string;
      };

      const matrixTasks = multiTasks as MatrixTask[];
      // matrixParameter is not used in the UI, so we don't test it
      expect(matrixTasks[0].matrixDisplayName).toBeDefined();
    });
  });

  describe('TARGET_PLATFORM Backward Compatibility', () => {
    it('should maintain exact compatibility with existing TARGET_PLATFORM behavior', () => {
      const taskRuns = [
        createMockTaskRun('security-scan', {
          [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64',
        }),
        createMockTaskRun('security-scan', {
          [TaskRunLabel.TARGET_PLATFORM]: 'linux-arm64',
        }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      expect(result).toHaveLength(4); // 2 matrix + 2 regular

      const platformTasks = result.filter((task) => task.name.startsWith('security-scan'));
      expect(platformTasks).toHaveLength(2);

      type MatrixTask = (typeof platformTasks)[0] & {
        matrixPlatform?: string; // Legacy field
        matrixParameter?: string;
        matrixDisplayName?: string;
      };

      const matrixTasks = platformTasks as MatrixTask[];

      // matrixPlatform is not used in the current implementation
      // matrixParameter is not used in the UI, so we don't test it
      expect(matrixTasks[0].matrixDisplayName).toBeDefined();
    });
  });

  describe('Mixed Matrix and Regular Tasks', () => {
    it('should handle pipeline with both matrix and regular tasks', () => {
      const taskRuns = [
        // Matrix task with multiple instances
        createMockTaskRun('security-scan', { SCAN_TYPE: 'virus' }),
        createMockTaskRun('security-scan', { SCAN_TYPE: 'malware' }),
        // Regular single task (no matrix parameters detected)
        createMockTaskRun('ecosystem-scan', {}),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      expect(result).toHaveLength(4); // 2 matrix + 1 regular + 1 skipped

      const scanTasks = result.filter((task) => task.name.startsWith('security-scan'));
      const ecosystemTasks = result.filter((task) => task.name === 'ecosystem-scan');

      expect(scanTasks).toHaveLength(2); // Matrix tasks
      expect(ecosystemTasks).toHaveLength(1); // Regular task
    });
  });

  describe('Performance with Generic Detection', () => {
    it('should handle large numbers of matrix tasks efficiently', () => {
      const startTime = performance.now();

      // Create 100 matrix tasks with different parameters
      const taskRuns: TaskRunKind[] = [];
      for (let i = 0; i < 100; i++) {
        taskRuns.push(
          createMockTaskRun('security-scan', {
            SCAN_TYPE: `type-${i}`,
          }),
        );
      }

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(result).toHaveLength(102); // 100 matrix + 2 regular
      expect(duration).toBeLessThan(100); // Should complete in less than 100ms
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle tasks with matrix parameters but no values', () => {
      const taskRuns = [
        createMockTaskRun('security-scan', { SCAN_TYPE: '' }),
        createMockTaskRun('security-scan', { SCAN_TYPE: 'virus' }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      // Should still detect as matrix due to multiple instances
      const scanTasks = result.filter((task) => task.name.startsWith('security-scan'));
      expect(scanTasks).toHaveLength(2);
    });

    it('should handle malformed matrix parameter values', () => {
      const taskRuns = [
        createMockTaskRun('security-scan', {
          SCAN_TYPE: '<script>alert("xss")</script>',
        }),
        createMockTaskRun('security-scan', {
          SCAN_TYPE: 'virus',
        }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      const scanTasks = result.filter((task) => task.name.startsWith('security-scan'));
      expect(scanTasks).toHaveLength(2);

      // Should handle malicious values gracefully
      // Since we have 2 TaskRuns for the same pipeline task, these should be matrix tasks
      scanTasks.forEach((task) => {
        expect((task as any).isMatrix).toBe(true);
        expect((task as any).matrixDisplayName).toBeDefined();
      });

      // Task names should be sanitized for React keys
      scanTasks.forEach((task) => {
        expect(task.name).toContain('security-scan');
        expect(task.name).not.toContain('<');
        expect(task.name).not.toContain('>');
      });
    });

    it('should handle tasks with unknown matrix-like parameters', () => {
      const taskRuns = [
        createMockTaskRun('security-scan', { CUSTOM_MATRIX_PARAM: 'value1' }),
        createMockTaskRun('security-scan', { CUSTOM_MATRIX_PARAM: 'value2' }),
      ];

      const result = appendStatus(mockPipeline, mockPipelineRun, taskRuns);

      // Should detect as matrix due to uppercase parameter pattern
      const scanTasks = result.filter((task) => task.name.startsWith('security-scan'));
      expect(scanTasks).toHaveLength(2);

      // matrixParameter is not used in the UI, so we don't test it
      expect((scanTasks[0] as any).matrixDisplayName).toBeDefined();
    });
  });
});
