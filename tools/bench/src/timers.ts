type Handle = ReturnType<typeof setTimeout>;
type Callback = (...args: unknown[]) => void;

/**
 * Runs `work` with the global timer functions wrapped, and returns how many timers it left armed:
 * timeouts that have neither fired nor been cleared, and intervals that have not been cleared.
 * The originals are restored before this returns, so nothing outlives the measurement.
 */
export async function countArmedTimers(work: () => Promise<void>): Promise<number> {
  const { setTimeout: originalTimeout, setInterval: originalInterval } = globalThis;
  const { clearTimeout: originalClearTimeout, clearInterval: originalClearInterval } = globalThis;
  const armed = new Set<Handle>();

  const wrappedTimeout = (handler: Callback, delay?: number, ...args: unknown[]) => {
    const handle: Handle = originalTimeout(
      (...callArgs: unknown[]) => {
        armed.delete(handle);
        handler(...callArgs);
      },
      delay,
      ...args,
    );
    armed.add(handle);
    return handle;
  };
  const wrappedInterval = (handler: Callback, delay?: number, ...args: unknown[]) => {
    const handle: Handle = originalInterval(handler, delay, ...args);
    armed.add(handle);
    return handle;
  };
  const clear = (original: (handle?: Handle) => void) => (handle?: Handle) => {
    if (handle !== undefined) armed.delete(handle);
    original(handle);
  };

  Object.assign(globalThis, {
    setTimeout: Object.assign(wrappedTimeout, originalTimeout),
    setInterval: Object.assign(wrappedInterval, originalInterval),
    clearTimeout: clear(originalClearTimeout),
    clearInterval: clear(originalClearInterval),
  });
  try {
    await work();
    return armed.size;
  } finally {
    Object.assign(globalThis, {
      setTimeout: originalTimeout,
      setInterval: originalInterval,
      clearTimeout: originalClearTimeout,
      clearInterval: originalClearInterval,
    });
  }
}
