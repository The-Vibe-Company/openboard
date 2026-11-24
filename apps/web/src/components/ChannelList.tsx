import { Link } from "@tanstack/react-router";

export function ChannelList({
  params,
  channels,
  selected,
}: {
  params: { org: string; board: string };
  channels: readonly { path: string }[];
  selected: string;
}) {
  return (
    <nav aria-label="Channels" className="board-channels">
      <h2>Channels</h2>
      <ul>
        {channels.map(({ path }) => (
          <li key={path}>
            <Link
              to="/$org/$board"
              params={params}
              search={{ channel: path }}
              aria-current={path === selected ? "page" : undefined}
              activeOptions={{ exact: true, includeSearch: true }}
            >
              {path}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
