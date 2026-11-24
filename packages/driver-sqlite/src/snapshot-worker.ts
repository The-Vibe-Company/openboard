import { vacuumCopy } from "./snapshot.ts";

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ file: string; copy: string }>) => void;
  postMessage(success: boolean): void;
};

worker.onmessage = ({ data }) => {
  try {
    vacuumCopy(data.file, data.copy);
    worker.postMessage(true);
  } catch {
    worker.postMessage(false);
  }
};
