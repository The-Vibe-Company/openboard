import "./Avatar.css";

export function Avatar({ name, src }: { name: string; src?: string }) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
  return (
    <span className="ui-avatar" role="img" aria-label={name}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{initial}</span>}
    </span>
  );
}
