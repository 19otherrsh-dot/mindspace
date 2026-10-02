import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from './client';

interface QueryState<T> {
  data: T | null;
  error: ApiRequestError | Error | null;
  loading: boolean;
  /** True while a pull-to-refresh is in flight, so the list stays visible. */
  refreshing: boolean;
  refetch: () => Promise<void>;
}

/**
 * A deliberately small data-fetching hook. The app's screens each read one or
 * two endpoints and re-fetch on focus, which does not justify pulling in a
 * full caching library.
 *
 * `deps` controls when the query re-runs, exactly like useEffect.
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
  options: { enabled?: boolean } = {},
): QueryState<T> {
  const enabled = options.enabled ?? true;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);

  // Keeps the latest fetcher without making it a dependency of the effect,
  // which would re-run on every render since callers pass inline closures.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (isRefresh: boolean, signal: AbortSignal) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const result = await fetcherRef.current(signal);
        if (signal.aborted || !mounted.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (signal.aborted || !mounted.current) return;
        // An aborted fetch is a navigation, not a failure worth showing.
        if ((err as Error)?.name === 'AbortError') return;
        setError(err as Error);
      } finally {
        if (!signal.aborted && mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void run(false, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  const refetch = useCallback(async () => {
    const controller = new AbortController();
    await run(true, controller.signal);
  }, [run]);

  return { data, error, loading, refreshing, refetch };
}
