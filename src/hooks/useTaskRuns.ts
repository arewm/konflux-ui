import * as React from 'react';
import { TaskRunKind, TektonResourceLabel } from '../types';
import { useTaskRuns as useTaskRuns2 } from './usePipelineRuns';

export const useTaskRuns = (
  namespace: string,
  pipelineRunName: string,
  taskName?: string,
): [TaskRunKind[], boolean, unknown] => {
  const [taskRuns, loaded, error, getNextPage, { hasNextPage, isFetchingNextPage }] = useTaskRuns2(
    namespace,
    React.useMemo(
      () => ({
        selector: {
          matchLabels: {
            [TektonResourceLabel.pipelinerun]: pipelineRunName,
            ...(taskName ? { [TektonResourceLabel.pipelineTask]: taskName } : {}),
          },
        },
      }),
      [pipelineRunName, taskName],
    ),
  );

  // Automatically fetch next page when available, but prevent infinite loops
  const hasTriggeredFetch = React.useRef(false);
  
  React.useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && getNextPage && loaded && !hasTriggeredFetch.current) {
      hasTriggeredFetch.current = true;
      getNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, getNextPage, loaded]);
  
  // Reset the flag when there are no more pages
  React.useEffect(() => {
    if (!hasNextPage) {
      hasTriggeredFetch.current = false;
    }
  }, [hasNextPage]);

  const sortedTaskRuns = React.useMemo(
    () =>
      taskRuns?.sort((a, b) => {
        if (a?.status?.completionTime) {
          return b?.status?.completionTime &&
            new Date(a?.status?.completionTime) > new Date(b?.status?.completionTime)
            ? 1
            : -1;
        }
        return b?.status?.startTime ||
          new Date(a?.status?.startTime) > new Date(b?.status?.startTime)
          ? 1
          : -1;
      }),
    [taskRuns],
  );
  return React.useMemo(() => [sortedTaskRuns, loaded, error], [sortedTaskRuns, loaded, error]);
};
