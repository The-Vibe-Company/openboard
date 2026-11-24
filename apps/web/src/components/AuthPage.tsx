import type { ReactNode } from "react";
import { Card } from "../ui/index.ts";
import "./AuthPage.css";

export function AuthPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section aria-labelledby="auth-title">
        <Card className="auth-card">
          <header>
            <span className="auth-logo">OpenBoard</span>
            <h1 id="auth-title">{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </Card>
      </section>
    </main>
  );
}
