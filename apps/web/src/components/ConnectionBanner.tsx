import "./ConnectionBanner.css";

export function ConnectionBanner({ reconnecting }: { reconnecting: boolean }) {
  return (
    <div className="connection-banner" role="status">
      {reconnecting && <p>Reconnecting…</p>}
    </div>
  );
}
