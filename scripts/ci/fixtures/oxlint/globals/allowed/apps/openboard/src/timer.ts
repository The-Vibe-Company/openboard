export const wait = (run: () => void): void => {
  setTimeout(run, 10);
};
export const tick = (run: () => void): void => {
  setInterval(run, 10);
};
export const viaGlobal = (run: () => void): void => {
  globalThis.setTimeout(run, 10);
};
