import type { OidcIssuer } from "../../oidc.ts";

export const githubOidc: OidcIssuer = {
  url: "https://token.actions.githubusercontent.com",
  identify({ repository, repository_id, workflow_ref, ref, event_name }) {
    if (
      typeof repository !== "string" ||
      !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      typeof repository_id !== "string" ||
      !/^\d+$/.test(repository_id) ||
      typeof workflow_ref !== "string" ||
      typeof ref !== "string" ||
      typeof event_name !== "string" ||
      event_name === ""
    )
      return null;
    const owner = `${repository.toLowerCase()}/`;
    if (!workflow_ref.toLowerCase().startsWith(owner)) return null;
    const [, workflow, workflowRef] =
      /^(\.github\/workflows\/[^@]+)@(.+)$/.exec(workflow_ref.slice(owner.length)) ?? [];
    if (!workflow) return null;
    return {
      id: `github:repo:${repository_id}`,
      principal: {
        kind: "github",
        repository,
        repositoryId: repository_id,
        ...(workflowRef === ref ? { workflow } : {}),
        ...(ref.startsWith("refs/heads/") ? { branch: ref.slice("refs/heads/".length) } : {}),
        event: event_name,
      },
    };
  },
};
