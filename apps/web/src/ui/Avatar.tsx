import { useState } from "react";
import "./Avatar.css";

export function Avatar({ name, src }: { name: string; src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
  const showImage = Boolean(src) && failedSrc !== src;
  return (
    <span className="ui-avatar" role="img" aria-label={name}>
      {showImage ? (
        <img src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
