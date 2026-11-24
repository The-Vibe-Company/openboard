import type { Named, OrgExport, Role } from "@openboard/contract";
import type { OrgAuditRecord } from "../org-audit-record.ts";
import type { Job, JobLease } from "../jobs.ts";

interface ExportPosition {
  head: number;
  shipped: number;
}

export interface ExportSource {
  organization: Named;
  log: ExportPosition;
  members: { principal: string; role: Role }[];
  boards: (Named & ExportPosition & { id: number; deleted: boolean })[];
  connections: { board: number; name: string; recreate: true }[];
  events(boardId: number, after: number, head: number): Promise<(object & { id: number })[]>;
}

export const EXPORT_ORG_JOB = "export-org";
export const EXPORT_RUN_MS = 600_000;

export interface OrgExports {
  exportAudit(after: number, limit: number): Promise<{ events: OrgAuditRecord[]; head: number }>;
  requestExport(id: string, personId: string, at: number, admit: () => void): Promise<OrgExport>;
  readExport(id: string, personId: string, at: number): Promise<OrgExport & { key: string }>;
  auditExportDownload(id: string, personId: string, at: number, admit: () => void): Promise<void>;
  runExport(
    job: Job,
    lease: JobLease,
    now: () => number,
    publish: (key: string, source: ExportSource, progress: () => Promise<boolean>) => Promise<void>,
    expire: (key: string) => Promise<void>,
  ): Promise<boolean>;
}
