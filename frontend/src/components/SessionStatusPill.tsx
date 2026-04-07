"use client";

import { Badge } from "@/components/ui/badge";

export interface SessionStatusProps {
  status: string;
  ended_by: string | null;
  feedback_ready: boolean;
  decision?: "offer" | "rejection" | null;
}

/**
 * Renders the status badge for a session row.
 *
 * Priority:
 *  1. No feedback + not active + ended_by=interviewer → "Ended by interviewer" (red)
 *  2. No feedback + not active                        → "Disconnected"          (amber)
 *  3. Active                                          → "In progress"           (italic text)
 *  4. Ended with feedback                             → "Completed" (+decision) (green)
 */
export function SessionStatusPill({ status, ended_by, feedback_ready, decision }: SessionStatusProps) {
  if (!feedback_ready && status !== "active") {
    if (ended_by === "interviewer") {
      return (
        <Badge variant="secondary" className="text-xs font-medium rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
          Ended by interviewer
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-xs font-medium rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
        Disconnected
      </Badge>
    );
  }

  if (status === "active") {
    return <span className="text-xs text-muted-foreground italic">In progress</span>;
  }

  // Ended + feedback ready
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge variant="secondary" className="text-xs font-medium rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
        Completed
      </Badge>
      {decision && (
        <Badge
          variant="secondary"
          className={`text-xs font-medium rounded-full ${
            decision === "offer" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-red-500/15 text-red-600 dark:text-red-400"
          }`}
        >
          {decision === "offer" ? "🎉 Offer" : "❌ Rejected"}
        </Badge>
      )}
    </div>
  );
}

/** Returns true when a session can be retried by the candidate. */
export function canRetry(s: Pick<SessionStatusProps, "status" | "ended_by" | "feedback_ready">): boolean {
  if (s.feedback_ready) return false;
  if (s.status === "active") return false;
  if (s.ended_by === "interviewer") return false;
  return true;
}
