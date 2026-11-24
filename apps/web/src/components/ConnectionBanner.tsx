import "./ConnectionBanner.css";

export function ConnectionBanner({ reconnecting }: { reconnecting: boolean }) {
  return (
    <div className="connection-banner" role="status">
      {reconnecting ? (
        <p className="connection-reconnecting">Reconnecting…</p>
      ) : (
        <span className="connection-live" title="Live updates connected">
          <span className="connection-live-dot" aria-hidden="true" />
          Live
        </span>
      )}
    </div>
  );
}
