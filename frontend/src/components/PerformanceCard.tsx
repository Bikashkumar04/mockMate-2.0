"use client";

import { useState, useCallback, useRef } from "react";
import Image from "next/image";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE, personaLabel } from "@/constants/common";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface PerformanceCardData {
  session_id: string;
  score: number;
  decision: "offer" | "rejection";
  decision_reason?: string | null;
  dimension_scores?: Record<string, number> | null;
  job_role: string;
  persona: string;
  interviewer_name: string;
  motivational_line: string;
  feedback_compiled_at?: string;
  has_background: boolean;
  image_url: string | null;
}

/* ── Score helpers ──────────────────────────────────────────────────── */

function scoreGradient(score: number) {
  if (score >= 85) return "from-amber-400 via-yellow-300 to-amber-500";
  if (score >= 70) return "from-emerald-400 via-green-300 to-emerald-500";
  if (score >= 50) return "from-orange via-amber-400 to-orange";
  return "from-red-400 via-rose-300 to-red-500";
}

function scoreSolidColor(score: number) {
  if (score >= 85) return "#f59e0b";
  if (score >= 70) return "#34d399";
  if (score >= 50) return "#f97316";
  return "#fb7185";
}

function decisionLabel(d: string) {
  return d.toLowerCase() === "offer" ? "OFFER" : "REJECTED";
}

function decisionColor(d: string) {
  return d.toLowerCase() === "offer"
    ? "bg-emerald-500/80 text-white border-emerald-500/30"
    : "bg-rose-500/80 text-white border-rose-500/30";
}

/* ── Component ──────────────────────────────────────────────────────── */

export default function PerformanceCard({
  card,
  compact = false,
  onCardClick,
}: {
  card: PerformanceCardData;
  userName?: string;
  compact?: boolean;
  onCardClick?: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const buildShareText = useCallback(() => {
    const lines: string[] = [
      `I scored ${card.score}/100 in a MockMate ${card.job_role} interview.`,
      `Interviewer persona: ${personaLabel(card.persona)}.`
    ];

    // Score breakdown
    if (card.dimension_scores && Object.keys(card.dimension_scores).length > 0) {
      const breakdown = Object.entries(card.dimension_scores)
        .map(([key, val]) => `  ${key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}: ${val}/100`)
        .join("\n");
      lines.push(`Score breakdown:\n${breakdown}`);
    }

    // Verdict
    const verdict = card.decision === "offer" ? "Offer ✅" : "Rejection ❌";
    
    lines.push(`Verdict: ${verdict}`);

    lines.push(
      `Response from MockMate: "${card.motivational_line}"`,
      "Attend your first mock interview for free at https://getmockmate.com!",
      "#MockMate #InterviewPrep #CareerGrowth",
    );

    return lines.join("\n\n");
  }, [card]);

  const renderCardBlob = useCallback(async () => {
    if (!captureRef.current) return null;

    const width = Math.max(captureRef.current.clientWidth, 320);
    const height = Math.max(captureRef.current.clientHeight, 240);
    const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
    const isSmUp = width >= 640;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);

    const fontFamily = getComputedStyle(document.body).fontFamily || "'Supreme', sans-serif";
    if (typeof document !== "undefined" && "fonts" in document) {
      try {
        await document.fonts.ready;
      } catch {
        // Use fallback fonts.
      }
    }

    const imageUrl = card.has_background && card.image_url
      ? `${API_BASE}${card.image_url}`
      : null;

    if (imageUrl) {
      try {
        const resp = await fetch(imageUrl, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);

        const srcRatio = bitmap.width / bitmap.height;
        const dstRatio = width / height;
        let srcX = 0;
        let srcY = 0;
        let srcW = bitmap.width;
        let srcH = bitmap.height;

        if (srcRatio > dstRatio) {
          srcW = Math.round(bitmap.height * dstRatio);
          srcX = Math.round((bitmap.width - srcW) / 2);
        } else {
          srcH = Math.round(bitmap.width / dstRatio);
          srcY = Math.round((bitmap.height - srcH) / 2);
        }

        ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, width, height);
      } catch {
        const bg = ctx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, "#1a1a2e");
        bg.addColorStop(0.5, "#16213e");
        bg.addColorStop(1, "#0f3460");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
      }
    } else {
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#1a1a2e");
      bg.addColorStop(0.5, "#16213e");
      bg.addColorStop(1, "#0f3460");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }

    const leftOverlay = ctx.createLinearGradient(0, 0, width, 0);
    leftOverlay.addColorStop(0, "rgba(0,0,0,0.9)");
    leftOverlay.addColorStop(0.6, "rgba(0,0,0,0.7)");
    leftOverlay.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = leftOverlay;
    ctx.fillRect(0, 0, width, height);

    const bottomOverlay = ctx.createLinearGradient(0, 0, 0, height);
    bottomOverlay.addColorStop(0, "rgba(0,0,0,0)");
    bottomOverlay.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = bottomOverlay;
    ctx.fillRect(0, 0, width, height);

    const pad = compact ? 12 : (isSmUp ? 24 : 16);

    // Top row
    const brandSize = compact ? 12 : (isSmUp ? 14 : 12);
    ctx.fillStyle = "#ff7a00";
    ctx.textBaseline = "top";
    ctx.font = `700 ${brandSize}px ${fontFamily}`;
    ctx.fillText("GETMOCKMATE.COM", pad, pad);

    const badgeText = decisionLabel(card.decision);
    const badgeFont = compact ? 10 : (isSmUp ? 12 : 10);
    const badgePaddingX = compact ? 8 : 10;
    const badgePaddingY = compact ? 4 : 6;
    ctx.font = `700 ${badgeFont}px ${fontFamily}`;
    const badgeW = Math.ceil(ctx.measureText(badgeText).width + badgePaddingX * 2);
    const badgeH = Math.ceil(badgeFont + badgePaddingY * 2);
    const badgeX = width - pad - badgeW;
    const badgeY = pad;
    ctx.fillStyle = card.decision === "offer" ? "rgba(16,185,129,0.85)" : "rgba(244,63,94,0.85)";
    ctx.beginPath();
    const r = Math.min(12, Math.floor(badgeH / 2));
    ctx.moveTo(badgeX + r, badgeY);
    ctx.arcTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + badgeH, r);
    ctx.arcTo(badgeX + badgeW, badgeY + badgeH, badgeX, badgeY + badgeH, r);
    ctx.arcTo(badgeX, badgeY + badgeH, badgeX, badgeY, r);
    ctx.arcTo(badgeX, badgeY, badgeX + badgeW, badgeY, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, badgeX + badgePaddingX, badgeY + badgeH / 2 + 0.5);

    // Middle block
    const centerY = compact ? Math.round(height * 0.48) : Math.round(height * 0.46);
    const scoreSize = compact ? 60 : (isSmUp ? 72 : 60);
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${scoreSize}px ${fontFamily}`;
    ctx.fillStyle = scoreSolidColor(card.score);
    ctx.fillText(String(card.score), pad, centerY);

    const scoreWidth = ctx.measureText(String(card.score)).width;
    const slashSize = compact ? 36 : 30;
    ctx.font = `300 ${slashSize}px ${fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("/100", pad + scoreWidth + 10, centerY);

    const roleFontSize = compact ? 14 : (isSmUp ? 20 : 18);
    const roleY = centerY + (compact ? 18 : (isSmUp ? 34 : 28));
    ctx.font = `600 ${roleFontSize}px ${fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fillText(card.job_role, pad, roleY);

    const metaFontSize = compact ? 12 : 14;
    ctx.font = `400 ${metaFontSize}px ${fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(
      `Interviewed by ${card.interviewer_name} - ${personaLabel(card.persona)}`,
      pad,
      roleY + (compact ? 18 : 28),
    );

    // Bottom quote (hidden in compact mode)
    if (!compact) {
      const quote = `"${card.motivational_line}"`;
      const quoteFont = isSmUp ? 16 : 14;
      const maxQuoteWidth = width - pad * 2;
      ctx.font = `italic 400 ${quoteFont}px ${fontFamily}`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.textBaseline = "top";

      const words = quote.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxQuoteWidth) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          line = word;
        }
        if (lines.length >= 2) break;
      }

      if (lines.length < 2 && line) lines.push(line);
      if (lines.length > 2) lines.length = 2;
      if (lines.length === 2 && ctx.measureText(lines[1]).width > maxQuoteWidth) {
        while (lines[1].length > 3 && ctx.measureText(`${lines[1]}...`).width > maxQuoteWidth) {
          lines[1] = lines[1].slice(0, -1);
        }
        lines[1] = `${lines[1]}...`;
      }

      const lineHeight = Math.round(quoteFont * 1.35);
      const startY = height - pad - lineHeight * lines.length;
      lines.forEach((l, i) => ctx.fillText(l, pad, startY + i * lineHeight));
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png", 1);
    });
    return blob;
  }, [card, compact]);

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onCardClick) return;
      const target = event.target as HTMLElement;
      if (target.closest("button") || target.closest("a")) return;
      onCardClick();
    },
    [onCardClick],
  );

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onCardClick) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onCardClick();
    },
    [onCardClick],
  );

  /* ── Download image reliably ──────────────────────────────────────── */
  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await renderCardBlob();
      if (!blob) throw new Error("Card render failed");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mockmate-performance-card-${card.session_id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, [card.session_id, renderCardBlob]);

  /* ── Share ───────────────────────────────────────────── */
  const handleShare = useCallback(async () => {
    const shareText = buildShareText();
    const linkedInText = `${shareText}`;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Mobile: use native share sheet
    if (isMobile && navigator.share) {
      try {
        await navigator.share({
          title: "Mock interview performance stats - MockMate",
          text: linkedInText,
          // url: "https://getmockmate.com",
        });
      } catch {
        // User cancelled or share failed — do nothing.
      }
      return;
    }

    // Desktop / fallback: open LinkedIn directly
    const linkedInUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(linkedInText)}`;

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(linkedInText);
      }
    } catch {
      // Ignore clipboard permission issues.
    }

    const anchor = document.createElement("a");
    anchor.href = linkedInUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [buildShareText]);

  const bgImageUrl = card.has_background
    ? `${API_BASE}${card.image_url}`
    : null;

  return (
    <Card
      className={`group relative w-full overflow-hidden rounded-2xl border-0 shadow-2xl ${onCardClick ? "cursor-pointer" : ""}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role={onCardClick ? "button" : undefined}
      tabIndex={onCardClick ? 0 : undefined}
    >
      {/* AI background image */}
      <div
        ref={captureRef}
        className={`relative w-full ${compact ? "aspect-square xs:aspect-video md:aspect-square" : "aspect-3/4 xs:aspect-square md:aspect-video"}`}
      >
        {bgImageUrl ? (
          <Image
            src={bgImageUrl}
            alt="Performance card background"
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 bg-linear-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]" />
        )}

        {/* Overlay for text legibility */}
        <div className="absolute inset-0 bg-linear-to-r from-black/90 via-black/70 to-transparent" />
        <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />

        {/* Content overlay */}
        <div className={`absolute inset-0 flex flex-col justify-between ${compact ? "p-3 gap-8" : "p-4 sm:p-6"}`}>
          {/* Top row: branding + decision */}
          <div className="flex items-center justify-between">
            <span className={`${compact ? "text-xs" : "text-xs xs:text-sm"} font-bold tracking-wider text-orange uppercase`}>
              GETMOCKMATE.COM
            </span>
            <Badge
              variant="outline"
              className={`${compact ? "text-[10px] px-1.5 py-0 h-5" : "text-[10px] xs:text-xs"} font-bold uppercase tracking-wide border ${decisionColor(card.decision)}`}
            >
              {decisionLabel(card.decision)}
            </Badge>
          </div>

          {/* Center: score + details */}
          <div className={`flex flex-col ${compact ? "gap-2" : "gap-2 sm:gap-3"}`}>
            <div className={`flex items-end ${compact ? "gap-1" : "gap-1.5 sm:gap-3"}`}>
              {/* <div className="self-center -mt-0.5">{scoreIcon(card.score)}</div> */}
              <span
                className={`${compact ? "text-6xl leading-none" : "text-6xl sm:text-7xl"} font-extrabold tracking-tight bg-linear-to-r ${scoreGradient(card.score)} bg-clip-text text-transparent`}
              >
                {card.score}
              </span>
              <span className={`${compact ? "text-4xl" : "text-3xl"} font-light text-white/30 self-end`}>
                /100
              </span>
            </div>
            <p className={`${compact ? "text-base" : "text-lg xs:text-xl"} font-semibold text-white/95 truncate`}>
              {card.job_role}
            </p>
            <p className={`${compact ? "text-sm" : "text-base"} text-white/50 truncate`}>
              Interviewed by {card.interviewer_name} &bull;{" "}
              {personaLabel(card.persona)}
            </p>
          </div>

          {/* Bottom: motivational line + actions */}
          <div className={`flex ${compact ? "justify-end" : "flex-col sm:flex-row sm:items-end justify-between"} gap-4`}>
            {!compact && (
              <p className="text-sm xs:text-base italic text-white/60 max-w-md leading-relaxed line-clamp-2">
                &ldquo;{card.motivational_line}&rdquo;
              </p>
            )}

            {/* Action buttons */}
            <div data-no-capture="true" className="flex items-center gap-2 shrink-0 ml-auto">
              <Button
                size="sm"
                variant="outline"
                className={`${compact ? "hidden" : "text-xs"} rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white gap-1.5 backdrop-blur-sm`}
                onClick={handleDownload}
                disabled={downloading}
              >
                <Download size={14} />
                <span className={`${compact ? "hidden" : "inline"}`}>
                  {downloading ? "Saving…" : "Download"}
                </span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={`${compact ? "h-8 px-3 text-xs" : "text-xs"} rounded-full border-white/20 bg-white/10 text-white hover:bg-[#0077b5]/80 hover:border-[#0077b5]/50 hover:text-white gap-1.5 backdrop-blur-sm`}
                onClick={handleShare}
              >
                <Share size={14} />
                <span className="inline">Share</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Loading skeleton ──────────────────────────────────────────────── */

export function PerformanceCardSkeleton() {
  return (
    <Card className="w-full overflow-hidden rounded-2xl border-0 shadow-2xl">
      <Skeleton className="aspect-video w-full rounded-none" />
    </Card>
  );
}
