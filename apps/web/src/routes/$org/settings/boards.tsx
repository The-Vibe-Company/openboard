import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { BoardError } from "@the-vibe-company/openboard";
import { type FormEvent, useState } from "react";
import { boardUrl, browserClient } from "../../../api/client.ts";
import { Button, Card, EmptyState, Field, Input, Table } from "../../../ui/index.ts";

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
      <Card>
        <h2 id="settings-boards">Boards</h2>
        {boards.isPending && <p role="status">Loading boards…</p>}
        {boards.isError && <p role="alert">{boards.error.message}</p>}
        {list &&
          (list.boards.length === 0 ? (
            <EmptyState>No boards yet.</EmptyState>
          ) : (
            <Table aria-labelledby="settings-boards" className="settings-boards-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">API address</th>
                </tr>
              </thead>
              <tbody>
                {list.boards.map((board) => {
                  const params = { org: org.slug, board: board.slug };
                  return (
                    <tr key={board.slug}>
                      <td>
                        <Link to="/$org/$board" params={params}>
                          {board.name}
                        </Link>
                      </td>
                      <td>
                        <code>{boardUrl(list.publicOrigin, params)}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ))}
        {list && (role === "admin" || role === "owner") && <CreateBoardForm key={org.slug} org={org.slug} />}
      </Card>
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
        <Field label="Name">
          {(props) => (
            <Input {...props} required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
        <Field label="Slug">
          {(props) => (
            <Input
              {...props}
              required
              pattern="[a-z0-9][a-z0-9\-]{1,38}"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          )}
        </Field>
      </fieldset>
      {error && (
        <div role="alert">
          <p>{slugTaken ? `${create.variables?.slug} is taken` : error.message}</p>
          {error instanceof BoardError && error.hint && <p>{error.hint}</p>}
        </div>
      )}
      <footer className="settings-card-footer">
        <Button type="submit" pending={create.isPending} disabled={!name.trim()}>
          {create.isPending ? "Creating…" : "Create board"}
        </Button>
      </footer>
    </form>
  );
}
