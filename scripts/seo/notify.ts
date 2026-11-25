import { createHash } from "node:crypto";

import type { Finding, RunReport } from "./core";

/**
 * Notification envelope (oa.notify/v1) for the OA Studio orchestrator.
 * The agent never sends anything itself: it writes envelopes, and the orchestrator resolves
 * `destination.route` (e.g. the HealthGuide.cy topic of the Command Center group) to a chat.
 * Chat ids and bot tokens never live in a site repository.
 */
export const NOTIFY_SCHEMA = "oa.notify/v1";

export interface NotificationEnvelope {
  schema: typeof NOTIFY_SCHEMA;
  id: string;
  created_at: string;
  source: { system: "seo-agent"; site_id: string; job: string; run_id: string };
  destination: { route: string };
  level: "critical" | "warning" | "info";
  title: string;
  text: string;
  facts: Array<{ label: string; value: string }>;
  links: Array<{ label: string; url: string }>;
  dedupe_key: string;
  requires_action: boolean;
  delivery: { mode: "immediate" | "digest"; digest: "daily"; for_date: string };
}

const JOB_TITLES: Record<string, string> = {
  critical: "Ежедневная проверка",
  "stats-indexing": "Статистика и индексация",
  "tech-audit": "Технический аудит",
  "weekly-report": "Недельный отчёт",
  "ai-visibility": "Видимость в AI Search",
  regression: "Проверка регрессий",
  redirects: "Редиректы",
  "drift-baseline": "Снимок SEO до изменений",
};

const RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

function problem(finding: Finding): boolean {
  return finding.verdict === "FAIL" || finding.verdict === "BLOCKER" || finding.verdict === "WARN";
}

/** Text stays under Telegram's 4096-character limit with room for the orchestrator's header. */
export function buildNotification(report: RunReport, siteName: string, maxItems = 8): NotificationEnvelope {
  const problems = report.findings.filter(problem).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const critical = problems.some((f) => f.severity === "critical" && f.verdict !== "WARN");
  const blocked = report.status === "blocked";
  const level: NotificationEnvelope["level"] = critical
    ? "critical"
    : blocked || report.status === "fail" || problems.some((f) => f.severity === "high")
      ? "warning"
      : "info";
  const icon = { critical: "🔴", warning: "🟠", info: "🟢" }[level];
  const verdictLine = report.status === "ok"
    ? `Всё в порядке. Проверено: ${report.coverage.checked} из ${report.coverage.discovered}.`
    : blocked && report.summary.FAIL === 0
      ? `⚠️ Проверка выполнена не полностью: результат неизвестен, это не «всё в порядке». Не проверено: ${report.summary.BLOCKER + report.coverage.failed_fetch + report.coverage.not_checked}.`
      : `Проблем: ${problems.length} (FAIL ${report.summary.FAIL}, WARN ${report.summary.WARN}, BLOCKER ${report.summary.BLOCKER}). Проверено: ${report.coverage.checked} из ${report.coverage.discovered}.`;
  const lines = [
    `${icon} ${siteName} · ${JOB_TITLES[report.job] ?? report.job}`,
    `${report.local_time.replace("T", " ")} (${report.timezone})`,
    "",
    verdictLine,
  ];
  for (const finding of problems.slice(0, maxItems)) {
    const where = finding.url ? ` ${new URL(finding.url).pathname}` : "";
    lines.push(`• [${finding.severity}] ${finding.check}${where}: ${finding.evidence}`.slice(0, 300));
  }
  if (problems.length > maxItems) lines.push(`…и ещё ${problems.length - maxItems}. Полный отчёт: ${report.run_id}`);
  const text = lines.join("\n").slice(0, 3500);
  return {
    schema: NOTIFY_SCHEMA,
    id: `${report.run_id}.notify`,
    created_at: report.finished_at,
    source: { system: "seo-agent", site_id: report.site_id, job: report.job, run_id: report.run_id },
    destination: { route: `site:${report.site_id}` },
    level,
    title: `${siteName}: ${JOB_TITLES[report.job] ?? report.job}`,
    text,
    facts: [
      { label: "status", value: report.status },
      { label: "fail", value: String(report.summary.FAIL) },
      { label: "warn", value: String(report.summary.WARN) },
      { label: "blocker", value: String(report.summary.BLOCKER) },
    ],
    links: [],
    // One alert per site, job and set of problems: an unchanged problem is not re-sent every day.
    dedupe_key: `${report.site_id}:${report.job}:${createHash("sha256").update(problems.map((f) => f.id).sort().join("|") || "ok").digest("hex").slice(0, 16)}`,
    requires_action: level !== "info",
    // Morning runs feed the 10:00 Asia/Nicosia Daily Digest; critical problems also go out at once.
    delivery: { mode: level === "critical" ? "immediate" : "digest", digest: "daily", for_date: report.local_time.slice(0, 10) },
  };
}
