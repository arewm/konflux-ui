import { TaskRunLabel } from '../consts/pipelinerun';
import { TaskRunKind, TektonResourceLabel } from '../types';

/**
 * Enhanced matrix parameter detection result
 */
export interface MatrixParameterInfo {
  /** The matrix parameter name (e.g., 'TARGET_PLATFORM', 'NODE_VERSION') */
  parameter: string;
  /** The matrix parameter value (e.g., 'linux-x86_64', '18.x') */
  value: string;
  /** Human-readable display name (e.g., 'linux/x86_64', 'Node 18.x') */
  displayName: string;
  /** Whether this is a known parameter type */
  isKnownParameter: boolean;
}

/**
 * Matrix task detection result
 */
export interface MatrixTaskInfo {
  /** Original task name */
  taskName: string;
  /** Array of matrix parameter information */
  matrixParameters: MatrixParameterInfo[];
  /** Whether this task has multiple matrix instances */
  isMatrix: boolean;
  /** Total number of matrix instances */
  instanceCount: number;
}

/**
 * Known matrix parameter configurations
 */
const KNOWN_MATRIX_PARAMETERS = new Map([
  [
    'TARGET_PLATFORM',
    {
      displayNameTransform: (value: string) => value.replace(/-/g, '/'),
      description: 'Target platform architecture',
    },
  ],
  [
    'build.appstudio.redhat.com/target-platform',
    {
      displayNameTransform: (value: string) => value.replace(/-/g, '/'),
      description: 'Target platform architecture (full label)',
    },
  ],
  [
    'NODE_VERSION',
    {
      displayNameTransform: (value: string) => `Node ${value}`,
      description: 'Node.js version',
    },
  ],
  [
    'PYTHON_VERSION',
    {
      displayNameTransform: (value: string) => `Python ${value}`,
      description: 'Python version',
    },
  ],
  [
    'GO_VERSION',
    {
      displayNameTransform: (value: string) => `Go ${value}`,
      description: 'Go version',
    },
  ],
  [
    'JAVA_VERSION',
    {
      displayNameTransform: (value: string) => `Java ${value}`,
      description: 'Java version',
    },
  ],
  [
    'scan.appstudio.redhat.com/scan-type',
    {
      displayNameTransform: (value: string) => value,
      description: 'Security scan type',
    },
  ],
  [
    'ecosystem.appstudio.redhat.com/ecosystem',
    {
      displayNameTransform: (value: string) => value,
      description: 'Ecosystem type',
    },
  ],
  [
    'test.appstudio.redhat.com/node-version',
    {
      displayNameTransform: (value: string) => `Node.js ${value}`,
      description: 'Node.js version for testing',
    },
  ],
]);

/**
 * Sanitizes and validates matrix parameter values
 */
export const sanitizeMatrixValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  // Convert to string if not already
  const stringValue = String(value);

  // Remove HTML tags and potentially dangerous characters, limit length
  return stringValue
    .trim()
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>&]/g, '') // Remove remaining dangerous characters but keep quotes
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .slice(0, 100); // Limit length
};

/**
 * Creates a display name for a matrix parameter value
 */
export const createMatrixDisplayName = (parameter: string, value: string): string => {
  const sanitizedValue = sanitizeMatrixValue(value);
  const config = KNOWN_MATRIX_PARAMETERS.get(parameter);

  if (config?.displayNameTransform) {
    try {
      return config.displayNameTransform(sanitizedValue);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Error transforming display name for ${parameter}:`, error);
    }
  }

  return sanitizedValue;
};

/**
 * Detects matrix parameters from TaskRun annotations
 */
export const detectMatrixParametersFromTaskRun = (taskRun: TaskRunKind): MatrixParameterInfo[] => {
  if (!taskRun?.metadata?.annotations) {
    return [];
  }

  const matrixParameters: MatrixParameterInfo[] = [];
  const annotations = taskRun.metadata.annotations;

  // Check for all possible matrix parameters
  Object.keys(annotations).forEach((annotationKey) => {
    // Skip non-matrix annotations
    if (
      annotationKey === TektonResourceLabel.pipelineTask ||
      annotationKey === 'tekton.dev/pipeline' ||
      annotationKey === 'tekton.dev/pipelineRun' ||
      annotationKey.startsWith('tekton.dev/') ||
      annotationKey.startsWith('app.kubernetes.io/')
    ) {
      return;
    }

    const annotationValue = annotations[annotationKey];
    if (!annotationValue) {
      return;
    }

    // Check if this is a known matrix parameter (like TARGET_PLATFORM)
    const isKnownParameter =
      KNOWN_MATRIX_PARAMETERS.has(annotationKey) || annotationKey === TaskRunLabel.TARGET_PLATFORM;

    // Check if this looks like a matrix parameter
    // Matrix parameters are typically uppercase or follow certain patterns
    // But exclude generic annotations that just happen to be uppercase
    const isLikelyMatrix =
      annotationKey.includes('VERSION') ||
      annotationKey.includes('PLATFORM') ||
      annotationKey.includes('TARGET') ||
      annotationKey.includes('MATRIX') ||
      annotationKey.includes('SCAN') ||
      annotationKey.includes('TYPE') ||
      isKnownParameter ||
      (/^[A-Z_]+[A-Z0-9_]*$/.test(annotationKey) &&
        annotationKey.length > 3 &&
        !annotationKey.includes('LABEL') &&
        !annotationKey.includes('RANDOM')) ||
      // Also consider appstudio.redhat.com annotations as potential matrix parameters
      annotationKey.includes('appstudio.redhat.com');

    if (isLikelyMatrix) {
      // For TARGET_PLATFORM, use the standard transformation but keep the original parameter name
      const parameterName =
        annotationKey === TaskRunLabel.TARGET_PLATFORM ? 'TARGET_PLATFORM' : annotationKey;
      const displayName = createMatrixDisplayName(parameterName, annotationValue);

      matrixParameters.push({
        parameter: annotationKey, // Keep the original annotation key
        value: annotationValue,
        displayName,
        isKnownParameter,
      });
    }
  });

  return matrixParameters;
};

/**
 * Groups TaskRuns by pipeline task name and detects matrix tasks
 */
export const detectMatrixTasks = (taskRuns: TaskRunKind[]): Map<string, MatrixTaskInfo> => {
  if (!taskRuns || taskRuns.length === 0) {
    return new Map();
  }

  // Group TaskRuns by pipeline task name
  const taskRunsByTaskName = new Map<string, TaskRunKind[]>();

  taskRuns.forEach((taskRun) => {
    const taskName = taskRun.metadata?.labels?.[TektonResourceLabel.pipelineTask];
    if (taskName) {
      const existing = taskRunsByTaskName.get(taskName) || [];
      existing.push(taskRun);
      taskRunsByTaskName.set(taskName, existing);
    }
  });

  // Analyze each task for matrix patterns
  const matrixTasks = new Map<string, MatrixTaskInfo>();

  taskRunsByTaskName.forEach((taskRunList, taskName) => {
    const instanceCount = taskRunList.length;

    // Detect matrix parameters from all instances
    const allMatrixParameters = new Set<string>();
    let hasMatrixParameters = false;

    taskRunList.forEach((taskRun) => {
      const matrixParams = detectMatrixParametersFromTaskRun(taskRun);
      matrixParams.forEach((param) => {
        allMatrixParameters.add(param.parameter);
        if (param.isKnownParameter || matrixParams.length > 0) {
          hasMatrixParameters = true;
        }
      });
    });

    // Consider it a matrix task if:
    // 1. Multiple instances exist, OR
    // 2. Has known matrix parameters (even with single instance)
    const isMatrix = instanceCount > 1 || hasMatrixParameters;

    // Get matrix parameters from first instance for consistency
    const matrixParameters =
      taskRunList.length > 0 ? detectMatrixParametersFromTaskRun(taskRunList[0]) : [];

    matrixTasks.set(taskName, {
      taskName,
      matrixParameters,
      isMatrix,
      instanceCount,
    });
  });

  return matrixTasks;
};

/**
 * Generates a unique task name for matrix instances
 */
export const generateMatrixTaskName = (
  originalName: string,
  matrixParameters: MatrixParameterInfo[],
): string => {
  if (matrixParameters.length === 0) {
    return originalName;
  }

  // Use the first parameter's value for the suffix
  const primaryParam = matrixParameters[0];
  if (!primaryParam || !primaryParam.value) {
    return originalName;
  }
  const suffix = primaryParam.value.replace(/[^a-zA-Z0-9]/g, '-');

  return `${originalName}-${suffix}`;
};

/**
 * Creates a human-readable display name for matrix tasks
 */
export const createMatrixTaskDisplayName = (
  originalName: string,
  matrixParameters: MatrixParameterInfo[],
  fallbackValue?: string,
): string => {
  if (matrixParameters.length === 0) {
    return fallbackValue || originalName;
  }

  // Create display name with all parameters
  const paramDisplays = matrixParameters
    .map((param) => param.displayName)
    .filter(Boolean)
    .join(', ');

  return paramDisplays ? `${originalName} (${paramDisplays})` : originalName;
};

/**
 * Validates matrix task structure
 */
export const validateMatrixTaskStructure = (
  taskRuns: TaskRunKind[],
  expectedTaskName: string,
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!taskRuns || taskRuns.length === 0) {
    errors.push('No TaskRuns provided');
    return { isValid: false, errors };
  }

  // Validate all TaskRuns belong to the same pipeline task
  const invalidTaskRuns = taskRuns.filter(
    (tr) => tr.metadata?.labels?.[TektonResourceLabel.pipelineTask] !== expectedTaskName,
  );

  if (invalidTaskRuns.length > 0) {
    errors.push(
      `${invalidTaskRuns.length} TaskRuns do not match expected task name: ${expectedTaskName}`,
    );
  }

  // Validate matrix parameter consistency
  const matrixParamSets = taskRuns.map((tr) => {
    const params = detectMatrixParametersFromTaskRun(tr);
    return new Set(params.map((p) => p.parameter));
  });

  if (matrixParamSets.length > 1) {
    const firstParamSet = matrixParamSets[0];
    const inconsistent = matrixParamSets.slice(1).some((paramSet) => {
      if (paramSet.size !== firstParamSet.size) return true;
      for (const param of paramSet) {
        if (!firstParamSet.has(param)) return true;
      }
      return false;
    });

    if (inconsistent) {
      errors.push('Matrix parameters are inconsistent across TaskRuns');
    }
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * Performance-optimized matrix detection with memoization support
 */
const matrixDetectionCache = new Map<string, Map<string, MatrixTaskInfo>>();

export const detectMatrixTasksWithCaching = (
  taskRuns: TaskRunKind[],
  cacheKey?: string,
): Map<string, MatrixTaskInfo> => {
  // Generate cache key if not provided
  const key = cacheKey || `${taskRuns.length}-${Date.now()}`;

  // Check cache first
  const cached = matrixDetectionCache.get(key);
  if (cached) {
    return cached;
  }

  // Perform detection
  const result = detectMatrixTasks(taskRuns);

  // Cache result (with size limit)
  if (matrixDetectionCache.size > 100) {
    // Clear oldest entries
    const entries = Array.from(matrixDetectionCache.keys());
    entries.slice(0, 50).forEach((k) => matrixDetectionCache.delete(k));
  }

  matrixDetectionCache.set(key, result);
  return result;
};

/**
 * Clears the matrix detection cache
 */
export const clearMatrixDetectionCache = (): void => {
  matrixDetectionCache.clear();
};

/**
 * Legacy compatibility function for TARGET_PLATFORM detection
 */
export const detectPlatformMatrixTasks = (taskRuns: TaskRunKind[]): Map<string, MatrixTaskInfo> => {
  const allMatrixTasks = detectMatrixTasks(taskRuns);
  const platformMatrixTasks = new Map<string, MatrixTaskInfo>();

  // Filter to only include tasks with TARGET_PLATFORM parameter
  allMatrixTasks.forEach((taskInfo, taskName) => {
    const hasPlatformMatrix = taskInfo.matrixParameters.some(
      (param) => param.parameter === TaskRunLabel.TARGET_PLATFORM,
    );

    if (hasPlatformMatrix) {
      platformMatrixTasks.set(taskName, taskInfo);
    }
  });

  return platformMatrixTasks;
};
