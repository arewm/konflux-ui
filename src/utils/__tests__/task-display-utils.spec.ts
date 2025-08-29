import { getTaskDisplayInfo } from '../task-display-utils';
import { getMatrixInstanceIndex } from '../../components/PipelineRun/PipelineRunDetailsView/visualization/utils/pipelinerun-graph-utils';
import { PipelineTask, TaskRunKind, PipelineRunKind } from '../../types';

describe('task-display-utils', () => {
  describe('getTaskDisplayInfo', () => {
    const mockPipelineRun: PipelineRunKind = {
      metadata: {
        name: 'test-pipeline-run',
        namespace: 'test-namespace',
      },
      status: {
        pipelineSpec: {
          tasks: [],
        },
        childReferences: [
          {
            name: 'taskrun-with-display',
            displayName: 'Custom Display Name',
          },
        ],
      },
    } as any;

    const mockTask: PipelineTask = {
      name: 'build-task',
      taskRef: { name: 'build-task' },
    };

    it('should return basic task info for regular tasks without displayName', () => {
      const mockTaskRun: TaskRunKind = {
        metadata: {
          name: 'taskrun-no-display',
          labels: {},
        },
      } as any;

      const result = getTaskDisplayInfo(mockTask, mockTaskRun, mockPipelineRun, [mockTaskRun]);

      expect(result.taskName).toBe('build-task');
      expect(result.additionalInfo).toBeUndefined();
      expect(result.displayString).toBe('build-task');
    });

    it('should include displayName from childReferences for regular tasks', () => {
      const mockTaskRun: TaskRunKind = {
        metadata: {
          name: 'taskrun-with-display',
          labels: {},
        },
      } as any;

      const result = getTaskDisplayInfo(mockTask, mockTaskRun, mockPipelineRun, [mockTaskRun]);

      expect(result.taskName).toBe('build-task');
      expect(result.additionalInfo).toBe('Custom Display Name');
      expect(result.displayString).toBe('build-task (Custom Display Name)');
    });

    it('should handle matrix tasks with multiple task runs', () => {
      const mockTaskRun1: TaskRunKind = {
        metadata: {
          name: 'taskrun-1',
          labels: { 'tekton.dev/pipelineTask': 'build-task' },
        },
      } as any;

      const mockTaskRun2: TaskRunKind = {
        metadata: {
          name: 'taskrun-2',
          labels: { 'tekton.dev/pipelineTask': 'build-task' },
        },
      } as any;

      const result = getTaskDisplayInfo(mockTask, mockTaskRun1, mockPipelineRun, [mockTaskRun1, mockTaskRun2]);

      expect(result.taskName).toBe('build-task');
      expect(result.additionalInfo).toBeDefined();
      expect(result.displayString).toContain('build-task (');
    });

    it('should handle empty task runs array', () => {
      const mockTaskRun: TaskRunKind = {
        metadata: {
          name: 'taskrun-empty-array',
          labels: {},
        },
      } as any;

      const result = getTaskDisplayInfo(mockTask, mockTaskRun, mockPipelineRun, []);

      expect(result.taskName).toBe('build-task');
      expect(result.additionalInfo).toBeUndefined();
      expect(result.displayString).toBe('build-task');
    });
  });

  describe('getMatrixInstanceIndex', () => {
    it('should extract matrix index from TaskRun name with numeric suffix', () => {
      const taskRun: TaskRunKind = {
        metadata: {
          name: 'build-task-linux-x86-64-0',
          labels: {},
        },
      } as any;

      const result = getMatrixInstanceIndex(taskRun);
      expect(result).toBe(0);
    });

    it('should extract matrix index from TaskRun name with higher index', () => {
      const taskRun: TaskRunKind = {
        metadata: {
          name: 'security-scan-virus-5',
          labels: {},
        },
      } as any;

      const result = getMatrixInstanceIndex(taskRun);
      expect(result).toBe(5);
    });

    it('should handle TaskRun names without numeric suffix', () => {
      const taskRun: TaskRunKind = {
        metadata: {
          name: 'regular-task',
          labels: {},
        },
      } as any;

      const result = getMatrixInstanceIndex(taskRun);
      expect(result).toBe(0);
    });

    it('should prioritize valid Tekton matrix index label over name extraction', () => {
      const taskRun: TaskRunKind = {
        metadata: {
          name: 'build-task-3',
          labels: {
            'tekton.dev/pipelineTask': 'build-task',
            'tekton.dev/matrix-index': '1',
          },
        },
      } as any;

      const result = getMatrixInstanceIndex(taskRun);
      expect(result).toBe(1);
    });

    it('should handle invalid Tekton matrix index label gracefully', () => {
      const taskRun: TaskRunKind = {
        metadata: {
          name: 'build-task-2',
          labels: {
            'tekton.dev/pipelineTask': 'build-task',
            'tekton.dev/matrix-index': 'invalid',
          },
        },
      } as any;

      const result = getMatrixInstanceIndex(taskRun);
      expect(result).toBe(2); // Falls back to name extraction when label is invalid
    });
  });
});
