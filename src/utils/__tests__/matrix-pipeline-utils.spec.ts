import { TaskRunLabel } from '../../consts/pipelinerun';
import { TaskRunKind } from '../../types';
import {
  detectMatrixParametersFromTaskRun,
  detectMatrixTasks,
  generateMatrixTaskName,
  createMatrixTaskDisplayName,
  validateMatrixTaskStructure,
  detectMatrixTasksWithCaching,
  clearMatrixDetectionCache,
  detectPlatformMatrixTasks,
  MatrixParameterInfo,
} from '../matrix-pipeline-utils';
import { runStatus } from '../pipeline-utils';

const TektonResourceLabel = {
  pipelineTask: 'tekton.dev/pipelineTask',
};

describe('Matrix Pipeline Utils', () => {
  const createMockTaskRun = (
    taskName: string,
    annotations: Record<string, string> = {},
    status: runStatus = runStatus['In Progress'],
  ): TaskRunKind => ({
    apiVersion: 'tekton.dev/v1',
    kind: 'TaskRun',
    metadata: {
      name: `${taskName}-run`,
      namespace: 'test-ns',
      labels: {
        [TektonResourceLabel.pipelineTask]: taskName,
      },
      annotations: {
        ...annotations,
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

  beforeEach(() => {
    clearMatrixDetectionCache();
  });

  describe('detectMatrixParametersFromTaskRun', () => {
    it('should detect TARGET_PLATFORM matrix parameter', () => {
      const taskRun = createMockTaskRun('build-task', {
        [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64',
      });

      const result = detectMatrixParametersFromTaskRun(taskRun);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        parameter: TaskRunLabel.TARGET_PLATFORM,
        value: 'linux-x86_64',
        displayName: 'linux/x86_64',
        isKnownParameter: true,
      });
    });

    it('should detect custom matrix parameters', () => {
      const taskRun = createMockTaskRun('test-task', {
        NODE_VERSION: '18.x',
        CUSTOM_PARAM: 'value123',
      });

      const result = detectMatrixParametersFromTaskRun(taskRun);

      expect(result).toHaveLength(2);

      const nodeVersionParam = result.find((p) => p.parameter === 'NODE_VERSION');
      expect(nodeVersionParam).toEqual({
        parameter: 'NODE_VERSION',
        value: '18.x',
        displayName: 'Node 18.x',
        isKnownParameter: true,
      });

      const customParam = result.find((p) => p.parameter === 'CUSTOM_PARAM');
      expect(customParam).toEqual({
        parameter: 'CUSTOM_PARAM',
        value: 'value123',
        displayName: 'value123',
        isKnownParameter: false,
      });
    });

    it('should skip non-matrix labels', () => {
      const taskRun = createMockTaskRun('build-task', {
        'tekton.dev/pipeline': 'my-pipeline',
        'app.kubernetes.io/name': 'myapp',
        'some-lowercase-label': 'value',
      });

      const result = detectMatrixParametersFromTaskRun(taskRun);

      expect(result).toHaveLength(0);
    });

    it('should handle TaskRun without labels', () => {
      const taskRun: TaskRunKind = {
        apiVersion: 'tekton.dev/v1',
        kind: 'TaskRun',
        metadata: {
          name: 'test-run',
          namespace: 'test-ns',
        },
        spec: { taskRef: { name: 'test' } },
      };

      const result = detectMatrixParametersFromTaskRun(taskRun);

      expect(result).toHaveLength(0);
    });

    it('should sanitize malicious parameter values', () => {
      const taskRun = createMockTaskRun('test-task', {
        DANGEROUS_PARAM: '<script>alert("xss")</script>',
        LONG_PARAM: 'a'.repeat(200), // Exceeds 100 char limit
      });

      const result = detectMatrixParametersFromTaskRun(taskRun);

      expect(result).toHaveLength(2);

      const dangerousParam = result.find((p) => p.parameter === 'DANGEROUS_PARAM');
      expect(dangerousParam?.displayName).toBe('alert("xss")'); // Enhanced sanitization removes script tags completely
      expect(dangerousParam?.displayName).not.toContain('<');
      expect(dangerousParam?.displayName).not.toContain('script'); // Should also not contain script text

      const longParam = result.find((p) => p.parameter === 'LONG_PARAM');
      expect(longParam?.displayName).toHaveLength(100);
    });
  });

  describe('detectMatrixTasks', () => {
    it('should detect matrix tasks with multiple instances', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-arm64' }),
        createMockTaskRun('regular-task'),
      ];

      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(2);

      const buildTask = result.get('build-task');
      expect(buildTask).toEqual({
        taskName: 'build-task',
        matrixParameters: [
          {
            parameter: TaskRunLabel.TARGET_PLATFORM,
            value: 'linux-x86_64',
            displayName: 'linux/x86_64',
            isKnownParameter: true,
          },
        ],
        isMatrix: true,
        instanceCount: 2,
      });

      const regularTask = result.get('regular-task');
      expect(regularTask).toEqual({
        taskName: 'regular-task',
        matrixParameters: [],
        isMatrix: false,
        instanceCount: 1,
      });
    });

    it('should detect matrix tasks with known parameters even with single instance', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
      ];

      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(1);

      const buildTask = result.get('build-task');
      expect(buildTask?.isMatrix).toBe(true);
      expect(buildTask?.instanceCount).toBe(1);
    });

    it('should handle empty TaskRun array', () => {
      const result = detectMatrixTasks([]);

      expect(result.size).toBe(0);
    });

    it('should handle TaskRuns without pipeline task labels', () => {
      const taskRun: TaskRunKind = {
        apiVersion: 'tekton.dev/v1',
        kind: 'TaskRun',
        metadata: {
          name: 'test-run',
          namespace: 'test-ns',
          labels: {},
        },
        spec: { taskRef: { name: 'test' } },
      };

      const result = detectMatrixTasks([taskRun]);

      expect(result.size).toBe(0);
    });

    it('should detect multiple matrix parameters', () => {
      const taskRuns = [
        createMockTaskRun('multi-matrix-task', {
          [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64',
          NODE_VERSION: '18.x',
        }),
        createMockTaskRun('multi-matrix-task', {
          [TaskRunLabel.TARGET_PLATFORM]: 'linux-arm64',
          NODE_VERSION: '20.x',
        }),
      ];

      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(1);

      const matrixTask = result.get('multi-matrix-task');
      expect(matrixTask?.isMatrix).toBe(true);
      expect(matrixTask?.matrixParameters).toHaveLength(2);
      expect(matrixTask?.matrixParameters?.map((p) => p.parameter)).toContain(
        TaskRunLabel.TARGET_PLATFORM,
      );
      expect(matrixTask?.matrixParameters?.map((p) => p.parameter)).toContain('NODE_VERSION');
    });
  });

  describe('generateMatrixTaskName', () => {
    it('should generate unique name with matrix parameters', () => {
      const matrixParameters: MatrixParameterInfo[] = [
        {
          parameter: TaskRunLabel.TARGET_PLATFORM,
          value: 'linux-x86_64',
          displayName: 'linux/x86_64',
          isKnownParameter: true,
        },
      ];

      const result = generateMatrixTaskName('build-task', matrixParameters);

      expect(result).toBe('build-task-linux-x86-64');
    });

    it('should return original name when no matrix parameters', () => {
      const result = generateMatrixTaskName('regular-task', []);

      expect(result).toBe('regular-task');
    });

    it('should handle special characters in parameter values', () => {
      const matrixParameters: MatrixParameterInfo[] = [
        {
          parameter: 'CUSTOM_PARAM',
          value: 'value/with@special#chars',
          displayName: 'value/with@special#chars',
          isKnownParameter: false,
        },
      ];

      const result = generateMatrixTaskName('test-task', matrixParameters);

      expect(result).toBe('test-task-value-with-special-chars');
    });
  });

  describe('createMatrixTaskDisplayName', () => {
    it('should create display name with single parameter', () => {
      const matrixParameters: MatrixParameterInfo[] = [
        {
          parameter: TaskRunLabel.TARGET_PLATFORM,
          value: 'linux-x86_64',
          displayName: 'linux/x86_64',
          isKnownParameter: true,
        },
      ];

      const result = createMatrixTaskDisplayName('build-task', matrixParameters);

      expect(result).toBe('build-task (linux/x86_64)');
    });

    it('should create display name with multiple parameters', () => {
      const matrixParameters: MatrixParameterInfo[] = [
        {
          parameter: TaskRunLabel.TARGET_PLATFORM,
          value: 'linux-x86_64',
          displayName: 'linux/x86_64',
          isKnownParameter: true,
        },
        {
          parameter: 'NODE_VERSION',
          value: '18.x',
          displayName: 'Node 18.x',
          isKnownParameter: true,
        },
      ];

      const result = createMatrixTaskDisplayName('test-task', matrixParameters);

      expect(result).toBe('test-task (linux/x86_64, Node 18.x)');
    });

    it('should return original name when no parameters', () => {
      const result = createMatrixTaskDisplayName('regular-task', []);

      expect(result).toBe('regular-task');
    });

    it('should use fallback value when no parameters and fallback provided', () => {
      const result = createMatrixTaskDisplayName('task', [], 'fallback-name');

      expect(result).toBe('fallback-name');
    });

    it('should handle empty display names', () => {
      const matrixParameters: MatrixParameterInfo[] = [
        {
          parameter: 'EMPTY_PARAM',
          value: 'value',
          displayName: '',
          isKnownParameter: false,
        },
      ];

      const result = createMatrixTaskDisplayName('test-task', matrixParameters);

      expect(result).toBe('test-task');
    });
  });

  describe('validateMatrixTaskStructure', () => {
    it('should validate correct matrix task structure', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-arm64' }),
      ];

      const result = validateMatrixTaskStructure(taskRuns, 'build-task');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect TaskRuns with wrong task name', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
        createMockTaskRun('different-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-arm64' }),
      ];

      const result = validateMatrixTaskStructure(taskRuns, 'build-task');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('1 TaskRuns do not match expected task name: build-task');
    });

    it('should detect inconsistent matrix parameters', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
        createMockTaskRun('build-task', { NODE_VERSION: '18.x' }),
      ];

      const result = validateMatrixTaskStructure(taskRuns, 'build-task');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Matrix parameters are inconsistent across TaskRuns');
    });

    it('should handle empty TaskRun array', () => {
      const result = validateMatrixTaskStructure([], 'build-task');

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('No TaskRuns provided');
    });
  });

  describe('detectMatrixTasksWithCaching', () => {
    it('should cache results correctly', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
      ];

      const result1 = detectMatrixTasksWithCaching(taskRuns, 'test-key');
      const result2 = detectMatrixTasksWithCaching(taskRuns, 'test-key');

      expect(result1).toBe(result2); // Should be same reference (cached)
      expect(result1.size).toBe(1);
    });

    it('should generate cache key when not provided', () => {
      const taskRuns = [
        createMockTaskRun('build-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
      ];

      const result = detectMatrixTasksWithCaching(taskRuns);

      expect(result.size).toBe(1);
    });

    it('should clear cache when limit exceeded', () => {
      // Fill cache beyond limit
      for (let i = 0; i < 105; i++) {
        detectMatrixTasksWithCaching([], `key-${i}`);
      }

      // Should still work (cache was cleaned)
      const result = detectMatrixTasksWithCaching([], 'final-key');
      expect(result.size).toBe(0);
    });
  });

  describe('detectPlatformMatrixTasks', () => {
    it('should only return tasks with TARGET_PLATFORM parameter', () => {
      const taskRuns = [
        createMockTaskRun('platform-task', { [TaskRunLabel.TARGET_PLATFORM]: 'linux-x86_64' }),
        createMockTaskRun('node-task', { NODE_VERSION: '18.x' }),
        createMockTaskRun('regular-task'),
      ];

      const result = detectPlatformMatrixTasks(taskRuns);

      expect(result.size).toBe(1);
      expect(result.has('platform-task')).toBe(true);
      expect(result.has('node-task')).toBe(false);
      expect(result.has('regular-task')).toBe(false);
    });

    it('should return empty map when no platform tasks exist', () => {
      const taskRuns = [
        createMockTaskRun('node-task', { NODE_VERSION: '18.x' }),
        createMockTaskRun('regular-task'),
      ];

      const result = detectPlatformMatrixTasks(taskRuns);

      expect(result.size).toBe(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle null/undefined TaskRuns gracefully', () => {
      expect(() => detectMatrixTasks(null as unknown as TaskRunKind[])).not.toThrow();
      expect(() => detectMatrixTasks(undefined as unknown as TaskRunKind[])).not.toThrow();

      const result = detectMatrixTasks(null as unknown as TaskRunKind[]);
      expect(result.size).toBe(0);
    });

    it('should handle malformed TaskRuns', () => {
      const malformedTaskRun = {
        // Missing required fields
        metadata: null,
      } as unknown as TaskRunKind;

      expect(() => detectMatrixTasks([malformedTaskRun])).not.toThrow();

      const result = detectMatrixTasks([malformedTaskRun]);
      expect(result.size).toBe(0);
    });

    it('should handle very long parameter values', () => {
      const taskRun = createMockTaskRun('test-task', {
        LONG_PARAM: 'x'.repeat(1000),
      });

      const matrixParams = detectMatrixParametersFromTaskRun(taskRun);

      expect(matrixParams[0].displayName).toHaveLength(100);
      expect(matrixParams[0].value).toHaveLength(1000); // Original value preserved
    });

    it('should handle parameters with empty values', () => {
      const taskRun = createMockTaskRun('test-task', {
        EMPTY_PARAM: '',
        NULL_PARAM: null as unknown as string,
        UNDEFINED_PARAM: undefined as unknown as string,
      });

      const matrixParams = detectMatrixParametersFromTaskRun(taskRun);

      // Should filter out empty/null/undefined values
      expect(matrixParams).toHaveLength(0);
    });
  });

  describe('Performance Tests', () => {
    it('should handle large numbers of TaskRuns efficiently', () => {
      const taskRuns = Array.from({ length: 1000 }, (_, i) =>
        createMockTaskRun(`task-${i % 10}`, {
          [TaskRunLabel.TARGET_PLATFORM]: `platform-${i % 5}`,
        }),
      );

      const startTime = performance.now();
      const result = detectMatrixTasks(taskRuns);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should complete in < 100ms
      expect(result.size).toBe(10); // 10 unique task names
    });

    it('should benefit from caching with repeated calls', () => {
      const taskRuns = Array.from({ length: 100 }, (_, i) =>
        createMockTaskRun(`task-${i % 5}`, { [TaskRunLabel.TARGET_PLATFORM]: `platform-${i % 3}` }),
      );

      // First call (no cache)
      const startTime1 = performance.now();
      detectMatrixTasksWithCaching(taskRuns, 'perf-test');
      const endTime1 = performance.now();

      // Second call (cached)
      const startTime2 = performance.now();
      detectMatrixTasksWithCaching(taskRuns, 'perf-test');
      const endTime2 = performance.now();

      expect(endTime2 - startTime2).toBeLessThan((endTime1 - startTime1) / 2);
    });
  });
});
