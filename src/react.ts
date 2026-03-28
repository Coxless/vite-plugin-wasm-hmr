import { useEffect, useState } from "react";

/**
 * React hook for async WASM module loading.
 *
 * HMR is handled automatically by the plugin's `import.meta.hot.accept()`
 * injection — no version tracking needed. This hook is purely for
 * ergonomic async loading of WASM modules.
 *
 * @example
 * ```tsx
 * const loadWasm = () => import("wasm");
 *
 * function Calculator() {
 *   const { wasm, loading, error } = useWasm(loadWasm);
 *   if (loading) return <p>Loading...</p>;
 *   if (error) return <p>Error: {error.message}</p>;
 *   return <p>{wasm!.add(1, 2)}</p>;
 * }
 * ```
 */
export function useWasm<T>(
  importFn: () => Promise<T>,
): { wasm: T | null; error: Error | null; loading: boolean } {
  const [wasm, setWasm] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    importFn().then(
      (mod) => {
        if (!cancelled) setWasm(mod);
      },
      (err) => {
        if (!cancelled) setError(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [importFn]);

  return { wasm, error, loading: !wasm && !error };
}
