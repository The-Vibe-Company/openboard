import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { browserClient } from "../../../api/client.ts";

export const Route = createFileRoute("/$org/settings/boards")({
  component: OrganizationBoards,
});

const settingsRoute = getRouteApi("/$org/settings");

function OrganizationBoards() {
  const { org, role } = settingsRoute.useLoaderData();
  const origin = window.location.origin;
  const client = browserClient(origin, { org: org.slug, board: "main" });
  const queryKey = ["organization-boards", org.slug] as const;
  const boards = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const [{ boards }, discovery] = await Promise.all([
        client.listBoards({ org: org.slug }, { signal }),
        client.discoverBoard({}, { signal }),
      ]);
      return { boards, publicOrigin: new URL(discovery.url).origin };
    },
    retry: false,
  });

  const list = boards.data;
  return (
    <section aria-labelledby="settings-boards">
      <h2 id="settings-boards">Boards</h2>
      {boards.isPending && <p role="status">Loading boards…</p>}
      {boards.isError && <p role="alert">{boards.error.message}</p>}
      {list && (
        <ul className="organization-boards">
          {list.boards.map((board) => {
            const path = `/${encodeURIComponent(org.slug)}/${encodeURIComponent(board.slug)}`;
            return (
              <li key={board.slug}>
                <a href={path}>{board.name}</a>
                <code>{new URL(`/api${path}`, list.publicOrigin).href}</code>
              </li>
            );
          })}
        </ul>
      )}
      {list && (role === "admin" || role === "owner") && <CreateBoardForm key={org.slug} org={org.slug} />}
    </section>
  );
}

function CreateBoardForm({ org }: { org: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const create = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      browserClient(window.location.origin).createBoard({ org, ...input }),
    onSuccess: async () => {
      setName("");
      setSlug("");
      await queryClient.invalidateQueries({ queryKey: ["organization-boards", org] });
    },
  });
  const error = create.error;
  const slugTaken = error instanceof BoardError && error.code === "slug_taken";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!create.isPending) create.mutate({ name: name.trim(), slug });
  }

  return (
    <form onSubmit={submit} aria-labelledby="create-board">
      <h3 id="create-board">Create a board</h3>
      <fieldset disabled={create.isPending}>
        <label>
          Name
          <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Slug
          <input
            required
            pattern="[a-z0-9][a-z0-9\-]{1,38}"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!name.trim()}>
          {create.isPending ? "Creating…" : "Create board"}
        </button>
      </fieldset>
      {error && (
        <div role="alert">
          <p>{slugTaken ? `${create.variables?.slug} is taken` : error.message}</p>
          {error instanceof BoardError && error.hint && <p>{error.hint}</p>}
        </div>
      )}
    </form>
  );
}
