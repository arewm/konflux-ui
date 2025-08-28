import { TaskRunKind, TektonResourceLabel } from '../../types';
import { detectMatrixTasks, detectMatrixTasksWithCaching, clearMatrixDetectionCache } from '../matrix-pipeline-utils';

describe('matrix-pipeline-utils', () => {
  const mockTaskRun = (name: string, pipelineTaskName: string): TaskRunKind => ({
    apiVersion: 'tekton.dev/v1',
    kind: 'TaskRun',
    metadata: {
      name,
      labels: {
        [TektonResourceLabel.pipelineTask]: pipelineTaskName,
      },
    },
    spec: {
      taskRef: { name: 'mock-task' },
    },
  } as TaskRunKind);

  beforeEach(() => {
    clearMatrixDetectionCache();
  });

  describe('detectMatrixTasks', () => {
    it('should return empty map for empty TaskRuns', () => {
      const result = detectMatrixTasks([]);
      expect(result.size).toBe(0);
    });

    it('should return empty map for null/undefined TaskRuns', () => {
      const result = detectMatrixTasks(null as unknown as TaskRunKind[]);
      expect(result.size).toBe(0);
    });

    it('should detect single TaskRun as non-matrix', () => {
      const taskRuns = [mockTaskRun('task-1', 'build-task')];
      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(1);
      const buildTask = result.get('build-task');
      expect(buildTask).toBeDefined();
      expect(buildTask?.isMatrix).toBe(false);
      expect(buildTask?.instanceCount).toBe(1);
    });

    it('should detect multiple TaskRuns with same pipeline task name as matrix', () => {
      const taskRuns = [
        mockTaskRun('build-task-linux-x86-64', 'build-task'),
        mockTaskRun('build-task-linux-arm64', 'build-task'),
      ];
      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(1);
      const buildTask = result.get('build-task');
      expect(buildTask).toBeDefined();
      expect(buildTask?.isMatrix).toBe(true);
      expect(buildTask?.instanceCount).toBe(2);
    });

    it('should handle multiple different tasks correctly', () => {
      const taskRuns = [
        mockTaskRun('init-1', 'init'),
        mockTaskRun('build-task-linux-x86-64', 'build-task'),
        mockTaskRun('build-task-linux-arm64', 'build-task'),
        mockTaskRun('test-1', 'test'),
      ];
      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(3);
      
      const initTask = result.get('init');
      expect(initTask?.isMatrix).toBe(false);
      expect(initTask?.instanceCount).toBe(1);

      const buildTask = result.get('build-task');
      expect(buildTask?.isMatrix).toBe(true);
      expect(buildTask?.instanceCount).toBe(2);

      const testTask = result.get('test');
      expect(testTask?.isMatrix).toBe(false);
      expect(testTask?.instanceCount).toBe(1);
    });

    it('should ignore TaskRuns without pipeline task labels', () => {
      const taskRuns = [
        mockTaskRun('task-1', 'build-task'),
        { ...mockTaskRun('task-2', 'build-task'), metadata: { name: 'task-2' } }, // No labels
        mockTaskRun('task-3', 'build-task'),
      ];
      const result = detectMatrixTasks(taskRuns);

      expect(result.size).toBe(1);
      const buildTask = result.get('build-task');
      expect(buildTask?.isMatrix).toBe(true);
      expect(buildTask?.instanceCount).toBe(2); // Only 2 valid TaskRuns
    });
  });

  describe('detectMatrixTasksWithCaching', () => {
    it('should return cached result for same input', () => {
      const taskRuns = [mockTaskRun('task-1', 'build-task')];
      
      const result1 = detectMatrixTasksWithCaching(taskRuns, 'cache-key-1');
      const result2 = detectMatrixTasksWithCaching(taskRuns, 'cache-key-1');
      
      expect(result1).toBe(result2); // Same reference due to caching
    });

    it('should return different results for different cache keys', () => {
      const taskRuns = [mockTaskRun('task-1', 'build-task')];
      
      const result1 = detectMatrixTasksWithCaching(taskRuns, 'cache-key-1');
      const result2 = detectMatrixTasksWithCaching(taskRuns, 'cache-key-2');
      
      expect(result1).not.toBe(result2); // Different references due to different cache keys
    });

    it('should generate cache key if not provided', () => {
      const taskRuns = [mockTaskRun('task-1', 'build-task')];
      
      const result1 = detectMatrixTasksWithCaching(taskRuns);
      const result2 = detectMatrixTasksWithCaching(taskRuns);
      
      // Should be different due to timestamp-based cache key generation
      expect(result1).not.toBe(result2);
    });
  });

  describe('clearMatrixDetectionCache', () => {
    it('should clear the cache', () => {
      const taskRuns = [mockTaskRun('task-1', 'build-task')];
      
      // Populate cache
      detectMatrixTasksWithCaching(taskRuns, 'cache-key-1');
      
      // Clear cache
      clearMatrixDetectionCache();
      
      // Should get new result (not cached)
      const result = detectMatrixTasksWithCaching(taskRuns, 'cache-key-1');
      expect(result.size).toBe(1);
    });
  });
});
