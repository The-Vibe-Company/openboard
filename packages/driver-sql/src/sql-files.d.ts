/** Migrations are imported as text (`with { type: "text" }`), so the compiled binary embeds them. */
declare module "*.sql" {
  const text: string;
  export default text;
}
