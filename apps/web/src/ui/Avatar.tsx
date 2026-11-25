import { useState } from "react";
import "./Avatar.css";

export function Avatar({ name, src }: { name: string; src?: string }) {
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
  const showImage = Boolean(src) && failedSrc !== src;
  const loaded = showImage && loadedSrc === src;
  return (
    <span className="ui-avatar" role="img" aria-label={name} data-initial={showImage ? initial : undefined}>
      {showImage ? (
        <img
          src={src}
          alt=""
          data-loaded={loaded ? "true" : "false"}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
