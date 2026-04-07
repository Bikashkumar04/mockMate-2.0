"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  PhoneOff,
  Loader2,
  User,
  Video,
  VideoOff,
  ChevronDown,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";

type InterviewStatus = "idle" | "connecting" | "active" | "ended" | "error";

interface TranscriptEntry {
  speaker: "you" | "interviewer" | "system";
  kind?: "message" | "stage";
  text: string;
  finished?: boolean;
  ts: number;
}

interface AdkEvent {
  type: "input_transcription" | "output_transcription" | "control" | "ping" | "error" | "session_meta";
  text?: string;
  finished?: boolean;
  turn_complete?: boolean;
  interrupted?: boolean;
  code?: string;
  message?: string;
  resume?: boolean;
  prior_turns?: number;
  transcript?: Array<{ speaker: string; text: string; ts?: string }>;
}

import { API_BASE, PERSONA_LABELS } from "@/constants/common";

// Derive WebSocket base from the API URL so the protocol matches automatically:
//   http://  → ws://   (local dev)
//   https:// → wss://  (production — avoids Mixed Content block)
// NEXT_PUBLIC_WS_URL can still override if needed.
const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ?? API_BASE.replace(/^http/, "ws");
const MIC_SAMPLE_RATE = 16000;
const OUT_SAMPLE_RATE = 24000;
const CUSTOM_JITTER_BUFFER_MS = 180;
const WS_RECONNECT_MAX_ATTEMPTS = 3;
const WS_RECONNECT_DELAY_MS = 2000;
const TRANSCRIPT_SYNC_MAX_WAIT_MS = 30_000;
const TRANSCRIPT_SYNC_POLL_MS = 800;
const POSTURE_FRAME_INTERVAL_MS = 20_000; // capture a frame every 20 seconds
const POSTURE_FRAME_QUALITY = 0.5;        // JPEG quality (0-1)
const POSTURE_FRAME_WIDTH = 640;
const POSTURE_FRAME_HEIGHT = 480;

function int16ToFloat32(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new Int16Array(buffer);
  const float = new Float32Array(new ArrayBuffer(view.length * 4));
  for (let i = 0; i < view.length; i++) float[i] = view[i] / 0x8000;
  return float;
}

function WaveBars({ active }: { active: boolean }) {
  const levels = [0.35, 0.7, 1, 0.55, 0.85, 0.45, 0.65];
  return (
    <div className="h-7 flex items-end gap-0.75">
      {levels.map((level, idx) => (
        <span
          key={idx}
          className={`w-1 rounded-full transition-all duration-300 ${active ? "bg-orange animate-pulse" : "bg-white/20"
            }`}
          style={{
            height: active ? `${Math.round(level * 100)}%` : "22%",
            transitionDelay: `${idx * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}

function ProfileAvatar({
  image,
  fallback,
  ai,
}: {
  image?: string | null;
  fallback: string;
  ai?: boolean;
}) {
  const [err, setErr] = useState(false);

  if (image && !err) {
    if (ai) {
      // Use unoptimized Next.js Image for interviewer avatars: they come from
      // the backend API and remote pattern configuration would vary per env.
      return (
        <Image
          src={image}
          alt={fallback}
          width={80}
          height={80}
          unoptimized
          onError={() => setErr(true)}
          className="w-20 h-20 rounded-full border border-white/15 object-cover"
        />
      );
    }
    return (
      <Image
        src={image}
        alt={fallback}
        width={80}
        height={80}
        onError={() => setErr(true)}
        className="w-20 h-20 rounded-full border border-white/15 object-cover"
      />
    );
  }

  const initial = fallback?.trim()?.[0]?.toUpperCase() ?? (ai ? "A" : "U");

  return (
    <div
      className={`w-20 h-20 rounded-full border border-white/15 flex items-center justify-center ${ai ? "bg-orange/20" : "bg-white/10"
        }`}
    >
      {ai ? (
        <span className="text-orange text-2xl font-bold select-none">
          {initial}
        </span>
      ) : (
        <User size={26} className="text-white/70" />
      )}
    </div>
  );
}

function ParticipantCard({
  title,
  subtitle,
  image,
  speaking,
  muted,
  ai,
  ended,
  active,
  videoRef,
  showVideo,
}: {
  title: string;
  subtitle: string;
  image?: string | null;
  speaking: boolean;
  muted?: boolean;
  ai?: boolean;
  ended?: boolean;
  active?: boolean;
  videoRef?: React.RefCallback<HTMLVideoElement>;
  showVideo?: boolean;
}) {
  const initials =
    title
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((t) => t[0]?.toUpperCase())
      .join("") || (ai ? "AI" : "U");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col items-center gap-2 min-w-36">
      {showVideo ? (
        <div
          className={`rounded-xl overflow-hidden m-1 transition-all duration-200 p-1.5 ${speaking ? "ring-4 ring-orange/60" : "ring-4 ring-transparent"
            }`}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video h-18 object-cover rounded-lg bg-black"
          />
        </div>
      ) : (
        <div
          className={`rounded-full p-1.5 aspect-square transition-all duration-200 ${speaking ? "ring-4 ring-orange/60" : "ring-4 ring-transparent"
            }`}
        >
          <ProfileAvatar image={image} fallback={title} ai={ai} />
        </div>
      )}

      <div className="text-center">
        <p className="text-white font-semibold text-sm">{title}</p>
        <p className="text-white/55 text-xs mt-0.5">{subtitle}</p>
      </div>

      <WaveBars active={speaking && !(muted && !ai)} />

      <div className="text-xs text-white/45 h-4">
        {ended
          ? ""
          : !active
            ? ""
            : muted && !ai
              ? "Muted"
              : speaking
                ? "Speaking…"
                : "Listening"}
      </div>

      {!image && (
        <div className="hidden" aria-hidden>
          {initials}
        </div>
      )}
    </div>
  );
}

/* Small stateful component so each transcript bubble can independently fall
   back to an initial-letter circle if the AI avatar fails to load. */
function InterviewerBubbleAvatar({
  src,
  name,
  initial,
}: {
  src: string | null;
  name: string;
  initial: string;
}) {
  const [err, setErr] = useState(false);
  if (src && !err) {
    return (
      <Image
        src={src}
        alt={name}
        width={28}
        height={28}
        unoptimized
        onError={() => setErr(true)}
        className="w-7 h-7 rounded-full shrink-0 object-cover"
      />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-white/10">
      <span className="text-white/70 text-xs font-bold select-none">{initial}</span>
    </div>
  );
}

function TypingBubble({
  speaker,
  interviewerInitial,
  userImage,
  interviewerImage,
}: {
  speaker: "you" | "interviewer";
  interviewerInitial: string;
  userImage?: string | null;
  interviewerImage?: string | null;
}) {
  const isAI = speaker === "interviewer";
  return (
    <div className={`flex gap-3 ${isAI ? "" : "flex-row-reverse"}`}>
      {isAI ? (
        interviewerImage ? (
          <InterviewerBubbleAvatar
            src={interviewerImage}
            name="Interviewer"
            initial={interviewerInitial}
          />
        ) : (
          <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-white/10">
            <span className="text-white/60 text-xs font-bold select-none">
              {interviewerInitial}
            </span>
          </div>
        )
      ) : userImage ? (
        <Image
          src={userImage}
          alt="You"
          width={28}
          height={28}
          className="w-7 h-7 rounded-full shrink-0 object-cover"
        />
      ) : (
        <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-orange text-white">
          <User size={14} />
        </div>
      )}
      <div
        className={`px-4 py-3 rounded-2xl border flex items-center gap-1.5 ${isAI ? "bg-white/5 border-white/10" : "bg-orange/15 border-orange/20"
          }`}
      >
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="w-1 h-1 rounded-full bg-white/50 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function LiveInterviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-dark flex items-center justify-center text-white/50">
          Loading…
        </div>
      }
    >
      <LiveInterviewContent />
    </Suspense>
  );
}

function LiveInterviewContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const queryClient = useQueryClient();

  const sessionId = params.get("session_id") ?? "";

  // Session details: initialize from URL params, then override with Firestore data
  const [personaId, setPersonaId] = useState(params.get("persona") ?? "neutral");
  const [jobRole, setJobRole] = useState(params.get("job_role") ?? "Software Engineer");
  const [difficulty, setDifficulty] = useState(params.get("difficulty") ?? "medium");
  const [interviewerName, setInterviewerName] = useState(params.get("interviewer_name") ?? "MockMate interviewer");
  const [avatarUrlPath, setAvatarUrlPath] = useState(params.get("avatar_url") ?? "");

  // ── Auth guard: redirect to /login if not authenticated ──────────────────
  useEffect(() => {
    if (!sessionPending && !session) {
      router.replace(`/login?next=/interview/live${params.toString() ? "?" + params.toString() : ""}`);
    }
  }, [session, sessionPending, router, params]);

  // ── Ownership gate + session detail hydration ─────────────────────────────
  const [ownershipChecked, setOwnershipChecked] = useState(false);
  useEffect(() => {
    if (sessionPending || !session || !sessionId) return;
    let cancelled = false;
    fetch(`${API_BASE}/session/${encodeURIComponent(sessionId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.user_id && data.user_id !== session.user.id) {
          router.replace("/dashboard");
        } else {
          // Hydrate session details from Firestore when available
          if (data) {
            if (data.persona) setPersonaId(data.persona);
            if (data.job_role) setJobRole(data.job_role);
            if (data.difficulty) setDifficulty(data.difficulty);
            if (data.interviewer_name) setInterviewerName(data.interviewer_name);
            if (data.interviewer_avatar_url) setAvatarUrlPath(data.interviewer_avatar_url);
          }
          setOwnershipChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setOwnershipChecked(true);
      });
    return () => { cancelled = true; };
  }, [session, sessionPending, sessionId, router]);

  const personaLabel = PERSONA_LABELS[personaId] ?? personaId;
  const interviewerInitial = interviewerName.trim()[0]?.toUpperCase() ?? "A";
  // Resolve avatar URL: path stored in Firestore + returned from session/start
  const interviewerAvatarUrl = avatarUrlPath ? `${API_BASE}${avatarUrlPath}` : null;
  const userImage = session?.user?.image ?? null;

  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [youSpeaking, setYouSpeaking] = useState(false);
  const [yourTurn, setYourTurn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [feedbackReady, setFeedbackReady] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const isActive = status === "active";

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const userSpeakingTimeoutRef = useRef<number | null>(null);
  const interviewerEndedRef = useRef(false);
  const pendingInterviewerEndRef = useRef(false);
  const interviewerEndTimeoutRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const wasEverActiveRef = useRef(false);
  const aiSpeakingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectingRef = useRef(false);
  const isResumeRef = useRef(false);
  const priorTranscriptLoadedRef = useRef(false);
  const noiseFloorRef = useRef(0);
  const speechStreakRef = useRef(0);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const cameraOnRef = useRef(false);
  const lastMicFrameAtRef = useRef(0);
  const micRecoveryInProgressRef = useRef(false);
  const lastMicRecoveryAtRef = useRef(0);
  const jitterQueueRef = useRef<ArrayBuffer[]>([]);
  const jitterQueuedMsRef = useRef(0);
  const jitterPrimedRef = useRef(false);

  useEffect(() => {
    cameraOnRef.current = cameraOn;
  }, [cameraOn]);

  useEffect(() => {
    aiSpeakingRef.current = aiSpeaking;
  }, [aiSpeaking]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, aiSpeaking, youSpeaking]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (status !== "active") {
      setAiSpeaking(false);
      setYouSpeaking(false);
      setYourTurn(false);
    }
  }, [status]);

  const appendStage = useCallback((text: string) => {
    setTranscript((prev) => [
      ...prev,
      { speaker: "system", kind: "stage", text, ts: Date.now() },
    ]);
  }, []);

  const closeAudioContextSafely = useCallback((ctx: AudioContext | null) => {
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => undefined);
    }
  }, []);

  const refreshMediaDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      const cams = devices.filter((d) => d.kind === "videoinput");
      setAudioInputs(mics);
      setVideoInputs(cams);
    } catch {
      // best effort only
    }
  }, []);

  useEffect(() => {
    void refreshMediaDevices();
    if (!navigator.mediaDevices?.addEventListener) return;

    const onDeviceChange = () => {
      void refreshMediaDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        onDeviceChange,
      );
    };
  }, [refreshMediaDevices]);

  const stopMicCapture = useCallback(() => {
    if (micProcessorRef.current) {
      micProcessorRef.current.port.close();
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const startCameraStream = useCallback(
    async (deviceId?: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? {
            deviceId: { exact: deviceId },
            width: { ideal: POSTURE_FRAME_WIDTH },
            height: { ideal: POSTURE_FRAME_HEIGHT },
          }
          : {
            facingMode: { ideal: "user" },
            width: { ideal: POSTURE_FRAME_WIDTH },
            height: { ideal: POSTURE_FRAME_HEIGHT },
          },
        audio: false,
      });

      camStreamRef.current?.getTracks().forEach((track) => track.stop());
      camStreamRef.current = stream;

      if (camVideoRef.current) {
        camVideoRef.current.srcObject = stream;
        void camVideoRef.current.play().catch(() => undefined);
      }

      const actualDeviceId = stream
        .getVideoTracks()?.[0]
        ?.getSettings()?.deviceId;
      if (actualDeviceId) setSelectedCameraId(actualDeviceId);
      setCameraOn(true);
      await refreshMediaDevices();
    },
    [refreshMediaDevices],
  );

  const scheduleInterviewerEnd = useCallback((delayMs: number = 1200) => {
    if (interviewerEndedRef.current) {
      return;
    }
    interviewerEndedRef.current = true;
    if (interviewerEndTimeoutRef.current) {
      window.clearTimeout(interviewerEndTimeoutRef.current);
    }
    interviewerEndTimeoutRef.current = window.setTimeout(() => {
      endInterviewRef.current?.("interviewer");
      interviewerEndTimeoutRef.current = null;
    }, delayMs);
  }, []);

  const persistSessionEndMutation = useMutation({
    mutationFn: async ({
      endedBy,
      finalTranscript,
    }: {
      endedBy: "candidate" | "interviewer" | "system";
      finalTranscript: TranscriptEntry[];
    }) => {
      if (!sessionId) return;
      const res = await fetch(
        `${API_BASE}/session/${encodeURIComponent(sessionId)}/end`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            ended_by: endedBy,
            transcript: finalTranscript,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  });

  const persistSessionEnd = useCallback(
    (
      endedBy: "candidate" | "interviewer" | "system",
      finalTranscript: TranscriptEntry[],
    ) => {
      return persistSessionEndMutation
        .mutateAsync({ endedBy, finalTranscript })
        .catch(() => {
          // best-effort persistence
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const waitForTranscriptUpload = useCallback(async () => {
    if (!sessionId) return false;

    const startedAt = Date.now();
    while (Date.now() - startedAt < TRANSCRIPT_SYNC_MAX_WAIT_MS) {
      try {
        const res = await fetch(
          `${API_BASE}/transcript/${encodeURIComponent(sessionId)}`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
          },
        );

        if (res.ok) {
          return true;
        }
      } catch {
        // retry until timeout
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, TRANSCRIPT_SYNC_POLL_MS);
      });
    }

    return false;
  }, [sessionId]);

  const sendAudioChunk = useCallback(
    (buffer: ArrayBuffer) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && !muted) {
        wsRef.current.send(buffer);
      }
    },
    [muted],
  );

  const sendChunkRef = useRef(sendAudioChunk);
  useEffect(() => {
    sendChunkRef.current = sendAudioChunk;
  }, [sendAudioChunk]);

  const startMic = useCallback(
    async (deviceId?: string) => {
      stopMicCapture();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // mono — required by Live API
          sampleRate: { ideal: MIC_SAMPLE_RATE },
          echoCancellation: true, // suppress AI audio fed back via speakers
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        video: false,
      });
      mediaStreamRef.current = stream;

      const actualDeviceId = stream
        .getAudioTracks()?.[0]
        ?.getSettings()?.deviceId;
      if (actualDeviceId) setSelectedMicId(actualDeviceId);

      if (!micCtxRef.current || micCtxRef.current.state === "closed") {
        micCtxRef.current = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      }

      const ctx = micCtxRef.current!;
      if (ctx.state === "suspended") await ctx.resume();

      await ctx.audioWorklet.addModule("/audio-processor.worklet.js");
      const source = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, "pcm-capture-processor");
      micProcessorRef.current = workletNode;
      lastMicFrameAtRef.current = Date.now();

      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        lastMicFrameAtRef.current = Date.now();
        const pcmBuffer = e.data;
        // Speech indicators run regardless of AI speaking state so the
        // user always sees visual feedback for their own voice.
        if (!muted && wsRef.current?.readyState === WebSocket.OPEN) {
          const samples = new Int16Array(pcmBuffer);
          let sumSquares = 0;
          for (let i = 0; i < samples.length; i++) {
            const normalized = samples[i] / 0x8000;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / Math.max(samples.length, 1));
          noiseFloorRef.current =
            noiseFloorRef.current === 0
              ? rms
              : noiseFloorRef.current * 0.92 + rms * 0.08;

          const dynamicThreshold = Math.max(0.02, noiseFloorRef.current * 2.4);

          if (rms > dynamicThreshold) {
            speechStreakRef.current += 1;
          } else {
            speechStreakRef.current = 0;
          }

          if (speechStreakRef.current >= 2) {
            setYouSpeaking(true);
            setYourTurn(true);
            if (userSpeakingTimeoutRef.current) {
              window.clearTimeout(userSpeakingTimeoutRef.current);
            }
            userSpeakingTimeoutRef.current = window.setTimeout(() => {
              setYouSpeaking(false);
            }, 1800);
          }
        }
        sendChunkRef.current(pcmBuffer);
      };

      source.connect(workletNode);
      await refreshMediaDevices();
    },
    [muted, refreshMediaDevices, stopMicCapture],
  );

  const drainJitterQueue = useCallback(() => {
    if (!outCtxRef.current) {
      outCtxRef.current = new AudioContext({ sampleRate: OUT_SAMPLE_RATE });
    }

    const ctx = outCtxRef.current;
    if (!jitterPrimedRef.current && jitterQueuedMsRef.current < CUSTOM_JITTER_BUFFER_MS) {
      return;
    }
    jitterPrimedRef.current = true;

    while (jitterQueueRef.current.length > 0) {
      const buffer = jitterQueueRef.current.shift();
      if (!buffer) break;
      const float32 = int16ToFloat32(buffer);
      const audioBuffer = ctx.createBuffer(1, float32.length, OUT_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);

      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextPlayTimeRef.current);
      src.start(startAt);
      nextPlayTimeRef.current = startAt + audioBuffer.duration;

      jitterQueuedMsRef.current = Math.max(0, jitterQueuedMsRef.current - (audioBuffer.duration * 1000));

      setYourTurn(false);
      setAiSpeaking(true);
      setYouSpeaking(false);
      speechStreakRef.current = 0;
      src.onended = () => {
        if (nextPlayTimeRef.current <= ctx.currentTime) {
          jitterPrimedRef.current = false;
          setAiSpeaking(false);
        }
      };
    }
  }, []);

  const enqueuePcmChunk = useCallback((buffer: ArrayBuffer) => {
    const frameMs = (new Int16Array(buffer).length / OUT_SAMPLE_RATE) * 1000;
    jitterQueueRef.current.push(buffer);
    jitterQueuedMsRef.current += frameMs;
    drainJitterQueue();
  }, [drainJitterQueue]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then(enqueuePcmChunk);
        } else {
          enqueuePcmChunk(event.data);
        }
        return;
      }

      try {
        const msg: AdkEvent = JSON.parse(event.data as string);

        // Keep-alive: respond to server pings immediately
        if (msg.type === "ping") {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "pong" }));
          }
          return;
        }

        // Session metadata from backend — tells us if this is a resume
        if (msg.type === "session_meta") {
          isResumeRef.current = msg.resume ?? false;
          if ((msg.resume || reconnectingRef.current) && wsRef.current?.readyState === WebSocket.OPEN) {
            const hasLocalHistory = transcriptRef.current.some(
              (entry) => entry.speaker === "you" || entry.speaker === "interviewer",
            );

            // Populate the chat with prior transcript turns so the user
            // can see the full conversation history from before the drop.
            // Only load prior transcript once — on reconnection the
            // session_meta fires again but we already have the turns.
            if (!hasLocalHistory && !priorTranscriptLoadedRef.current) {
              priorTranscriptLoadedRef.current = true;
              if (msg.transcript && Array.isArray(msg.transcript)) {
                const priorEntries: TranscriptEntry[] = msg.transcript
                  .filter((t: { text?: string }) => t.text?.trim())
                  .map((t: { speaker: string; text: string; ts?: string }) => ({
                    speaker: (t.speaker === "user" ? "you" : "interviewer") as "you" | "interviewer",
                    text: t.text,
                    finished: true,
                    ts: t.ts ? new Date(t.ts).getTime() : Date.now(),
                  }));
                if (priorEntries.length > 0) {
                  // Append prior turns after existing stage messages (e.g.
                  // "Interview started") so nothing gets overwritten.
                  setTranscript((prev) => [...prev, ...priorEntries]);
                }
              }
              appendStage(
                `Resuming interview (${msg.prior_turns ?? 0} prior exchanges loaded)`,
              );
            }

            // Use client-side transcript as a fallback resume context so the
            // interviewer can continue naturally even if backend transcript
            // persistence lagged during a reconnect race.
            const clientContextTurns = transcriptRef.current
              .filter(
                (entry) =>
                  (entry.speaker === "you" || entry.speaker === "interviewer") &&
                  !!entry.text?.trim(),
              )
              .slice(-40)
              .map((entry) =>
                `${entry.speaker === "you" ? "CANDIDATE" : "INTERVIEWER"}: ${entry.text.trim()}`,
              )
              .join("\n");

            if (clientContextTurns) {
              wsRef.current.send(
                JSON.stringify({
                  type: "text",
                  text:
                    `[CONNECTION RESUME CONTEXT]\n` +
                    `Use this as prior conversation history and continue from where you left off. ` +
                    `Do not restart the interview or repeat already covered questions.\n\n` +
                    clientContextTurns,
                }),
              );
            }

            // Tell the AI the candidate has reconnected — different from
            // the fresh-start kickstart so the AI continues naturally.
            wsRef.current.send(
              JSON.stringify({
                type: "text",
                text: "[The candidate has reconnected after a connection interruption. Welcome them back briefly and continue the interview from where you left off. DO NOT repeat or summarize what was discussed before.]",
              }),
            );
          } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            // Fresh start — send the normal kickstart
            wsRef.current.send(
              JSON.stringify({
                type: "text",
                text: "[The candidate has joined the interview. Please begin.]",
              }),
            );
          }
          return;
        }

        // Server-side error events (ADK errors, Gemini API errors, etc.)
        if (msg.type === "error") {
          console.error("[MockMate] Server error:", msg.code, msg.message);
          // Terminal errors — show in transcript but don't end immediately
          // (the server may recover via session resumption)
          const isTerminal = msg.code === "SAFETY" || msg.code === "MAX_TOKENS";
          if (isTerminal) {
            setTranscript((prev) => [
              ...prev,
              {
                speaker: "system" as const,
                kind: "stage" as const,
                text: `Interview ended: ${msg.message || msg.code || "server error"}`,
                ts: Date.now(),
              },
            ]);
            endInterviewRef.current?.("system");
          }
          return;
        }

        if (
          (msg.type === "input_transcription" ||
            msg.type === "output_transcription") &&
          msg.text?.trim()
        ) {
          const text = msg.text.trim();
          const speaker =
            msg.type === "input_transcription" ? "you" : "interviewer";
          const finished = msg.finished ?? false;

          // Only add to transcript once the utterance is complete.
          // Partials cause flickering word-by-word display and fragment
          // bubbles ("oo", "about") — the typing indicator already gives
          // visual feedback that someone is speaking.
          if (!finished) {
            if (speaker === "interviewer") setYourTurn(false);
            return;
          }

          setTranscript((prev) => {
            return [...prev, { speaker, text, finished: true, ts: Date.now() }];
          });

          if (speaker === "interviewer") setYourTurn(false);
        }

        if (msg.type === "control") {
          if (msg.turn_complete) {
            setAiSpeaking(false);
            setYourTurn(true);
            // If an end phrase was detected, wait for audio to fully drain
            // before ending — prevents cutting off the interviewer mid-sentence.
            if (pendingInterviewerEndRef.current) {
              pendingInterviewerEndRef.current = false;
              const ctx = outCtxRef.current;
              const drainMs = ctx
                ? Math.max(
                  0,
                  (nextPlayTimeRef.current - ctx.currentTime) * 1000,
                ) + 400
                : 800;
              scheduleInterviewerEnd(drainMs);
            }
          }
        }

        // Auto-detect interviewer ending the interview and execute the same flow as End Interview button
        if (msg.type === "output_transcription" && msg.text) {
          const lower = msg.text.toLowerCase();
          const endPhrases = [
            "end the interview",
            "wraps up our interview",
            "that covers everything",
            "thanks for your time today",
            "best of luck",
            "we'll be in touch",
            "not able to have a productive conversation",
            "good speaking with you",
          ];
          if (endPhrases.some((p) => lower.includes(p))) {
            pendingInterviewerEndRef.current = true;
          }
        }

        // Detect candidate requesting to end and trigger end directly
        if (msg.type === "input_transcription" && msg.finished && msg.text) {
          const lower = msg.text.toLowerCase();
          const userEndPhrases = [
            "end the call",
            "end the interview",
            "stop the interview",
            "end this",
            "hang up",
            "i want to stop",
            "please stop",
            "let's stop",
            "let's end",
            "can we stop",
            "can we end",
          ];
          if (userEndPhrases.some((p) => lower.includes(p))) {
            // Show a brief message before disconnecting so the user sees
            // confirmation that the call is ending.
            setTranscript((prev) => [
              ...prev,
              {
                speaker: "system" as const,
                kind: "stage" as const,
                text: "Ending the interview…",
                ts: Date.now(),
              },
            ]);
            // Small delay so the message is visible before teardown
            window.setTimeout(() => {
              endInterviewRef.current?.("candidate");
            }, 600);
          }
        }
      } catch {
        // ignore non-json
      }
    },
    [enqueuePcmChunk, scheduleInterviewerEnd, appendStage],
  );

  const startInterview = useCallback(async () => {
    if (!session) {
      setError("Your session has expired. Please refresh the page and sign in again.");
      setStatus("error");
      return;
    }
    if (!sessionId) {
      setError("No session ID provided. Please start from the setup page.");
      setStatus("error");
      return;
    }

    setStatus("connecting");
    setError(null);
    setTranscript([]);
    interviewerEndedRef.current = false;
    pendingInterviewerEndRef.current = false;
    endingRef.current = false;
    wasEverActiveRef.current = false;
    reconnectAttemptsRef.current = 0;
    reconnectingRef.current = false;
    if (interviewerEndTimeoutRef.current) {
      window.clearTimeout(interviewerEndTimeoutRef.current);
      interviewerEndTimeoutRef.current = null;
    }
    setYourTurn(false);
    noiseFloorRef.current = 0;
    speechStreakRef.current = 0;

    // Clean up any stale resources from a previous failed attempt so
    // the retry starts fresh (avoids orphaned AudioContexts and lets
    // the audio processor be re-created on the new context.
    stopMicCapture();
    closeAudioContextSafely(micCtxRef.current);
    micCtxRef.current = null;
    micProcessorRef.current = null;
    setFeedbackReady(false);

    try {
      // Pre-check: reject sessions that ended and already have feedback.
      const checkRes = await fetch(
        `${API_BASE}/session/${encodeURIComponent(sessionId)}`,
      );
      if (checkRes.ok) {
        const sessionData = await checkRes.json();
        // Ownership check — only the session owner may join the live interview
        if (sessionData.user_id && session?.user?.id && sessionData.user_id !== session.user.id) {
          setError("You don't have permission to access this interview session.");
          setStatus("error");
          return;
        }
        if (sessionData.status === "ended" && sessionData.feedback_ready) {
          setError(
            "This session has already been completed. Please create a new interview from the setup page.",
          );
          setStatus("error");
          return;
        }
      }

      // Request microphone access BEFORE opening the WebSocket so the AI
      // doesn't start speaking while the permission dialog is still open.
      // If the user denies access, we bail out without opening the connection
      // (session stays "created" and can be retried immediately).
      try {
        await startMic(selectedMicId || undefined);
      } catch (micErr: unknown) {
        const isDenied =
          micErr instanceof DOMException &&
          (micErr.name === "NotAllowedError" ||
            micErr.name === "PermissionDeniedError");
        setError(
          isDenied
            ? "Microphone access was blocked. Please allow microphone access in your browser settings (click the lock icon in the address bar) and try again."
            : "Could not access the microphone. Please check your device settings and try again.",
        );
        setStatus("error");
        return;
      }

      // Runtime guard: if the page is served over HTTPS but the configured
      // WS_BASE still uses ws://, upgrade to wss:// to avoid Mixed Content
      // blocks (browsers throw SecurityError / silent onerror on mobile).
      const safeWsBase =
        typeof window !== "undefined" &&
          window.location.protocol === "https:" &&
          WS_BASE.startsWith("ws://")
          ? WS_BASE.replace("ws://", "wss://")
          : WS_BASE;
      const ws = new WebSocket(`${safeWsBase}/ws/interview/${sessionId}?user_id=${encodeURIComponent(session?.user?.id ?? "")}`);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setStatus("active");
        wasEverActiveRef.current = true;
        appendStage("Interview started");
        // The kickstart message is now sent when we receive the
        // "session_meta" event from the backend, which tells us whether
        // this is a fresh start or a resume.  This ensures the AI gets
        // the right instruction ("begin" vs "continue where you left off").
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        if (endingRef.current) return;

        // Some browser/network failures fire onerror first and delay/skip
        // a meaningful onclose. Kick off reconnect here as well.
        if (
          wasEverActiveRef.current &&
          !reconnectingRef.current &&
          reconnectAttemptsRef.current < WS_RECONNECT_MAX_ATTEMPTS
        ) {
          reconnectAttemptsRef.current += 1;
          reconnectingRef.current = true;
          const attempt = reconnectAttemptsRef.current;
          appendStage(`Connection error — reconnecting (${attempt}/${WS_RECONNECT_MAX_ATTEMPTS})…`);

          window.setTimeout(() => {
            if (endingRef.current) return;
            const safeWsBase =
              typeof window !== "undefined" &&
                window.location.protocol === "https:" &&
                WS_BASE.startsWith("ws://")
                ? WS_BASE.replace("ws://", "wss://")
                : WS_BASE;
            const rws = new WebSocket(`${safeWsBase}/ws/interview/${sessionId}?user_id=${encodeURIComponent(session?.user?.id ?? "")}`);
            wsRef.current = rws;
            rws.binaryType = "arraybuffer";

            rws.onopen = () => {
              reconnectAttemptsRef.current = 0;
              reconnectingRef.current = false;
              appendStage("Reconnected — interview continues");
            };
            rws.onmessage = handleMessage;
            rws.onerror = ws.onerror;
            rws.onclose = ws.onclose;
          }, WS_RECONNECT_DELAY_MS);
          return;
        }

        // If the interview was already active, let reconnect/close flow handle it.
        if (wasEverActiveRef.current) return;

        // SecurityError (ws:// from https://) and network errors both surface here.
        const isHttps =
          typeof window !== "undefined" &&
          window.location.protocol === "https:";
        const msg = isHttps
          ? "Connection failed. Make sure NEXT_PUBLIC_API_URL is set to an https:// address in your deployment environment."
          : "WebSocket connection error. Ensure the backend is running and reachable.";
        setError(msg);
        setStatus("error");
      };

      ws.onclose = (e) => {
        if (e.code === 4404) {
          setError("Session not found. Please start a new interview.");
          setStatus("error");
        } else if (e.code === 4403) {
          setError("You don't have permission to access this interview session.");
          setStatus("error");
        } else if (e.code === 4409) {
          setError(
            "This session has already been used. Please create a new interview from the setup page.",
          );
          setStatus("error");
        } else if (
          // Abnormal close while interview is active and user didn't end it:
          // attempt transparent reconnection instead of immediately ending.
          e.code !== 1000 &&
          wasEverActiveRef.current &&
          !endingRef.current &&
          !reconnectingRef.current &&
          reconnectAttemptsRef.current < WS_RECONNECT_MAX_ATTEMPTS
        ) {
          reconnectAttemptsRef.current += 1;
          reconnectingRef.current = true;
          const attempt = reconnectAttemptsRef.current;
          console.warn(
            `[MockMate] WS closed unexpectedly (code=${e.code}). ` +
            `Reconnect attempt ${attempt}/${WS_RECONNECT_MAX_ATTEMPTS}…`,
          );
          appendStage(`Connection lost — reconnecting (${attempt}/${WS_RECONNECT_MAX_ATTEMPTS})…`);

          window.setTimeout(() => {
            if (endingRef.current) return;
            const safeWsBase =
              typeof window !== "undefined" &&
                window.location.protocol === "https:" &&
                WS_BASE.startsWith("ws://")
                ? WS_BASE.replace("ws://", "wss://")
                : WS_BASE;
            const rws = new WebSocket(`${safeWsBase}/ws/interview/${sessionId}?user_id=${encodeURIComponent(session?.user?.id ?? "")}`);
            wsRef.current = rws;
            rws.binaryType = "arraybuffer";

            rws.onopen = () => {
              reconnectAttemptsRef.current = 0;
              reconnectingRef.current = false;
              appendStage("Reconnected — interview continues");
              // The kickstart message is deferred to the session_meta
              // handler in handleMessage — the backend will send
              // session_meta with resume=true which triggers the right
              // resume kickstart automatically.
            };

            rws.onmessage = handleMessage;
            rws.onerror = () => {
              // Let onclose handle it
            };
            // Recursive — this same onclose handler runs on the new socket
            rws.onclose = ws.onclose;
          }, WS_RECONNECT_DELAY_MS);
        } else {
          if (reconnectingRef.current && !endingRef.current) {
            return;
          }
          reconnectingRef.current = false;
          setStatus((prev) => {
            if (prev === "active") {
              appendStage("Interview ended (connection closed)");
              setAiSpeaking(false);
              setYouSpeaking(false);
              setYourTurn(false);
              return "ended";
            }
            return prev;
          });
        }
      };
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, [
    session,
    sessionId,
    handleMessage,
    startMic,
    appendStage,
    selectedMicId,
    closeAudioContextSafely,
    stopMicCapture,
  ]);

  useEffect(() => {
    if (!isActive) return;

    const timer = window.setInterval(() => {
      if (endingRef.current || muted) return;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      if (micRecoveryInProgressRef.current) return;

      const hasLiveTrack =
        mediaStreamRef.current
          ?.getAudioTracks()
          .some((track) => track.readyState === "live") ?? false;
      const stalledMs = Date.now() - lastMicFrameAtRef.current;
      const cooldownMs = Date.now() - lastMicRecoveryAtRef.current;

      if (hasLiveTrack && stalledMs < 9000) return;
      if (cooldownMs < 7000) return;

      micRecoveryInProgressRef.current = true;
      lastMicRecoveryAtRef.current = Date.now();
      appendStage("Microphone signal dropped — recovering…");

      void (async () => {
        try {
          await startMic(selectedMicId || undefined);
          appendStage("Microphone recovered");
        } catch {
          setError("Microphone capture dropped. Please check mic permissions/device.");
        } finally {
          micRecoveryInProgressRef.current = false;
        }
      })();
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isActive, muted, appendStage, startMic, selectedMicId]);

  const endInterview = useCallback(
    async (endedBy: "candidate" | "interviewer" | "system" = "candidate") => {
      if (endingRef.current) {
        return;
      }
      endingRef.current = true;

      const stageText =
        endedBy === "interviewer"
          ? "Interview ended by interviewer"
          : endedBy === "candidate"
            ? "Interview ended by candidate"
            : "Interview ended";
      const stageEntry: TranscriptEntry = {
        speaker: "system",
        kind: "stage",
        text: stageText,
        ts: Date.now(),
      };
      const finalTranscript = [...transcriptRef.current, stageEntry];
      setTranscript(finalTranscript);

      // Graceful shutdown: signal end first, then fallback close if backend
      // hasn't closed the socket shortly after.
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "end" }));
        window.setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.close(1000);
          }
        }, 350);
      }

      micProcessorRef.current?.disconnect();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      camStreamRef.current?.getTracks().forEach((track) => track.stop());
      camStreamRef.current = null;
      setCameraOn(false);
      closeAudioContextSafely(micCtxRef.current);
      closeAudioContextSafely(outCtxRef.current);
      if (interviewerEndTimeoutRef.current) {
        window.clearTimeout(interviewerEndTimeoutRef.current);
        interviewerEndTimeoutRef.current = null;
      }

      setStatus("ended");
      setAiSpeaking(false);
      setYouSpeaking(false);
      setYourTurn(false);
      speechStreakRef.current = 0;
      await persistSessionEnd(endedBy, finalTranscript);
      const transcriptUploaded = await waitForTranscriptUpload();
      // Bust the React Query cache for this session so the feedback page
      // always fetches the latest transcript and regenerates feedback from
      // the full (prior + new) transcript rather than showing stale data.
      queryClient.removeQueries({ queryKey: ["feedback", sessionId] });
      queryClient.removeQueries({ queryKey: ["transcript", sessionId] });
      if (transcriptUploaded) {
        setFeedbackReady(true);
      } else {
        setError(
          "Transcript is still syncing. Please wait a moment and try again.",
        );
      }
    },
    [
      closeAudioContextSafely,
      persistSessionEnd,
      queryClient,
      sessionId,
      waitForTranscriptUpload,
    ],
  );

  const endInterviewRef = useRef(endInterview);
  useEffect(() => {
    endInterviewRef.current = endInterview;
  }, [endInterview]);

  const toggleMute = useCallback(() => {
    setMuted((curr) => {
      const next = !curr;
      mediaStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      if (next) setYouSpeaking(false);
      if (next) setYourTurn(false);
      if (next) speechStreakRef.current = 0;
      return next;
    });
  }, []);

  const toggleCamera = useCallback(async () => {
    if (cameraOn) {
      camStreamRef.current?.getTracks().forEach((track) => track.stop());
      camStreamRef.current = null;
      if (camVideoRef.current) {
        camVideoRef.current.srcObject = null;
      }
      setCameraOn(false);
      return;
    }

    try {
      await startCameraStream(selectedCameraId || undefined);
    } catch {
      setError("Camera access denied. Please allow webcam access and retry.");
    }
  }, [cameraOn, selectedCameraId, startCameraStream]);

  const handleMicDeviceChange = useCallback(
    async (deviceId: string) => {
      setSelectedMicId(deviceId);
      if (!isActive) return;
      try {
        await startMic(deviceId || undefined);
      } catch {
        setError(
          "Could not switch microphone. Please check permissions and retry.",
        );
      }
    },
    [isActive, startMic],
  );

  const handleCameraDeviceChange = useCallback(
    async (deviceId: string) => {
      setSelectedCameraId(deviceId);
      if (!isActive || !cameraOn) return;
      try {
        await startCameraStream(deviceId || undefined);
      } catch {
        setError(
          "Could not switch camera. Please check permissions and retry.",
        );
      }
    },
    [cameraOn, isActive, startCameraStream],
  );

  const statusLabel = useMemo(() => {
    if (status === "active") return "Live";
    if (status === "connecting") return "Connecting…";
    if (status === "ended") return "Ended";
    if (status === "error") return "Error";
    return "Ready";
  }, [status]);

  const selectedMicLabel = useMemo(() => {
    if (!audioInputs.length) return "No microphones found";
    if (!selectedMicId) return "System default microphone";
    const selected = audioInputs.find(
      (device) => device.deviceId === selectedMicId,
    );
    return selected?.label || "Selected microphone";
  }, [audioInputs, selectedMicId]);

  const selectedCameraLabel = useMemo(() => {
    if (!videoInputs.length) return "No cameras found";
    if (!selectedCameraId) return "System default camera";
    const selected = videoInputs.find(
      (device) => device.deviceId === selectedCameraId,
    );
    return selected?.label || "Selected camera";
  }, [videoInputs, selectedCameraId]);

  // Safety net: sync camera stream → video element whenever cameraOn toggles.
  // The inline ref callback handles the initial attach, but React can call it
  // with null on re-renders (since it's a new function identity each time).
  // This effect guarantees the stream is re-attached after any re-render cycle.
  useEffect(() => {
    const el = camVideoRef.current;
    const stream = camStreamRef.current;
    if (isActive && cameraOn && el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      void el.play().catch(() => undefined);
    }
  }, [cameraOn, isActive]);

  // ── Posture analysis: periodic frame capture ───────────────────────
  // When the camera is on and the interview is active, capture a JPEG
  // frame from the video element every POSTURE_FRAME_INTERVAL_MS and
  // send it to the backend for posture analysis.
  useEffect(() => {
    if (!isActive || !cameraOn) return;

    const sendPostureFrame = () => {
      const video = camVideoRef.current;
      const ws = wsRef.current;
      if (!video || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = POSTURE_FRAME_WIDTH;
        canvas.height = POSTURE_FRAME_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw frame directly to 640x480 for stable transport payload.
        ctx.drawImage(video, 0, 0, POSTURE_FRAME_WIDTH, POSTURE_FRAME_HEIGHT);

        // Convert to base64 JPEG (strip the data:image/jpeg;base64, prefix)
        const dataUrl = canvas.toDataURL("image/jpeg", POSTURE_FRAME_QUALITY);
        const base64Data = dataUrl.split(",")[1];
        if (base64Data) {
          ws.send(
            JSON.stringify({
              type: "video_frame",
              data: base64Data,
              timestamp_ms: Date.now(),
            }),
          );
        }
      } catch {
        // Best effort — don't crash the interview for a failed frame capture
      }
    };

    // Capture one frame immediately when posture tracking becomes active.
    sendPostureFrame();

    const intervalId = window.setInterval(() => {
      sendPostureFrame();
    }, POSTURE_FRAME_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [cameraOn, isActive]);

  useEffect(() => {
    return () => {
      if (userSpeakingTimeoutRef.current) {
        window.clearTimeout(userSpeakingTimeoutRef.current);
      }
      if (interviewerEndTimeoutRef.current) {
        window.clearTimeout(interviewerEndTimeoutRef.current);
      }
      wsRef.current?.close();
      stopMicCapture();
      camStreamRef.current?.getTracks().forEach((track) => track.stop());
      closeAudioContextSafely(micCtxRef.current);
      closeAudioContextSafely(outCtxRef.current);
    };
  }, [closeAudioContextSafely, stopMicCapture]);

  return (
    <div className="dark h-screen bg-dark text-white flex flex-col overflow-hidden">
      <AppHeader
        homeHref="/dashboard"
        name={session?.user?.name}
        email={session?.user?.email}
        image={session?.user?.image}
      />

      {/* Interview info + status bar */}
      <div className="shrink-0 bg-dark border-b border-white/10 px-5 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        <p className="text-xs sm:text-sm text-white/45 truncate">
          <span className="text-primary">Job role </span>{jobRole}
          {" | "}
          <span className="text-primary">Persona </span>{personaLabel}
          {" | "}
          <span className="text-primary">Difficulty </span>{difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
        </p>
        <span
          className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${status === "active"
              ? "bg-green-500/20 text-green-400"
              : status === "connecting"
                ? "bg-yellow-500/20 text-yellow-400"
                : status === "ended"
                  ? "bg-blue-500/20 text-blue-400"
                  : status === "error"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-white/10 text-white/60"
            }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <aside className="lg:w-60 xl:w-68 border-b lg:border-b-0 lg:border-r border-white/10 p-3 shrink-0 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto">
          <div className="flex lg:flex-col gap-2 min-w-max lg:min-w-0">
            <ParticipantCard
              title={interviewerName}
              subtitle={`${personaLabel} interviewer`}
              image={interviewerAvatarUrl}
              speaking={aiSpeaking}
              ai
              ended={status === "ended"}
              active={isActive}
            />
            <ParticipantCard
              title={session?.user?.name ?? "You"}
              subtitle="Candidate"
              image={session?.user?.image}
              speaking={youSpeaking && !muted}
              muted={muted}
              ended={status === "ended"}
              active={isActive}
              showVideo={isActive && cameraOn}
              videoRef={(node) => {
                camVideoRef.current = node;
                if (
                  node &&
                  camStreamRef.current &&
                  node.srcObject !== camStreamRef.current
                ) {
                  node.srcObject = camStreamRef.current;
                  void node.play().catch(() => undefined);
                }
              }}
            />
          </div>
        </aside>

        <main className="flex-1 min-h-0 flex flex-col">
          {/* Sticky camera-on reminder for posture analysis */}
          {isActive && !cameraOn && (
            <div className="p-4">
              <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-orange/15 border border-orange/30 text-orange text-xs font-medium w-fit mx-auto">
                <Video size={14} className="shrink-0" />
                <span>Turn on your camera (from bottom toolbar) to enable AI posture &amp; presence analysis</span>
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 flex flex-col gap-3">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
                {error}{error.includes("create a new interview") ? <Link href="/interview/setup?from=dashboard" className="underline ml-1">Go to setup page</Link> : null}
              </div>
            )}

            {transcript.length === 0 && isActive && aiSpeaking && (
              <TypingBubble
                speaker="interviewer"
                interviewerInitial={interviewerInitial}
                interviewerImage={interviewerAvatarUrl}
                userImage={userImage}
              />
            )}
            {transcript.length === 0 &&
              isActive &&
              (youSpeaking || (yourTurn && !aiSpeaking)) &&
              !muted && (
                <TypingBubble
                  speaker="you"
                  interviewerInitial={interviewerInitial}
                  interviewerImage={interviewerAvatarUrl}
                  userImage={userImage}
                />
              )}

            {transcript.length === 0 &&
              !error &&
              !aiSpeaking &&
              !youSpeaking &&
              !(yourTurn && !muted) && (
                <div className="flex-1 flex items-center justify-center text-white/35 text-sm text-center">
                  {status === "idle" && (ownershipChecked ? "Click Start Interview to begin." : "Verifying access…")}
                  {status === "connecting" && "Connecting to your interviewer…"}
                  {status === "active" &&
                    "The conversation transcript will appear here."}
                  {status === "ended" &&
                    "Interview complete. Feedback is being compiled."}
                </div>
              )}

            {transcript.map((entry, i) =>
              entry.kind === "stage" ? (
                <div
                  key={`${entry.ts}-${i}`}
                  className="flex justify-center py-1"
                >
                  <div className="px-3 py-1 rounded-full border border-white/15 bg-white/5 text-white/55 text-xs">
                    {entry.text}
                  </div>
                </div>
              ) : (
                <div
                  key={`${entry.ts}-${i}`}
                  className={`flex gap-3 ${entry.speaker === "you" ? "flex-row-reverse" : ""}`}
                >
                  {entry.speaker === "interviewer" ? (
                    <InterviewerBubbleAvatar
                      src={interviewerAvatarUrl}
                      name={interviewerName}
                      initial={interviewerInitial}
                    />
                  ) : userImage ? (
                    <Image
                      src={userImage}
                      alt="You"
                      width={28}
                      height={28}
                      className="w-7 h-7 rounded-full shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center bg-orange text-white">
                      <User size={14} />
                    </div>
                  )}

                  <div
                    className={`max-w-[84%] sm:max-w-[76%] px-4 py-3 rounded-2xl text-sm leading-relaxed border ${entry.speaker === "you"
                        ? "bg-orange/15 border-orange/20 text-white"
                        : "bg-white/5 border-white/10 text-white/90"
                      }`}
                  >
                    {entry.text}
                  </div>
                </div>
              ),
            )}

            {/* Typing indicator — anchored at bottom once transcript has started */}
            {isActive && transcript.length > 0 && aiSpeaking && (
              <TypingBubble
                speaker="interviewer"
                interviewerInitial={interviewerInitial}
                interviewerImage={interviewerAvatarUrl}
                userImage={userImage}
              />
            )}
            {isActive &&
              transcript.length > 0 &&
              (youSpeaking || (yourTurn && !aiSpeaking)) &&
              !muted && (
                <TypingBubble
                  speaker="you"
                  interviewerInitial={interviewerInitial}
                  interviewerImage={interviewerAvatarUrl}
                  userImage={userImage}
                />
              )}

            <div ref={transcriptEndRef} />
          </div>

          <div className="shrink-0 border-t border-white/10 px-4 sm:px-6 py-4 flex flex-col items-center gap-3">
            {(status === "idle" ||
              status === "error" ||
              status === "connecting" ||
              isActive) && (
                <div className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        disabled={
                          status === "connecting" || audioInputs.length === 0
                        }
                        className="w-full flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 disabled:opacity-50"
                      >
                        <Mic size={14} className="text-white/60" />
                        <span className="shrink-0">Mic</span>
                        <span className="ml-auto min-w-0 truncate text-left">
                          {selectedMicLabel}
                        </span>
                        <ChevronDown
                          size={14}
                          className="text-white/60 shrink-0"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-88 max-w-[calc(100vw-2rem)] bg-zinc-900 border-white/15 text-white"
                    >
                      <DropdownMenuLabel className="text-white/60">
                        Microphones
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-white/10" />
                      <DropdownMenuRadioGroup
                        value={selectedMicId}
                        onValueChange={(value) => {
                          void handleMicDeviceChange(value);
                        }}
                      >
                        <DropdownMenuRadioItem
                          value=""
                          className="text-white/85 focus:bg-white/10 focus:text-white"
                        >
                          System default microphone
                        </DropdownMenuRadioItem>
                        {audioInputs.map((device, index) => (
                          <DropdownMenuRadioItem
                            key={device.deviceId}
                            value={device.deviceId}
                            className="text-white/85 focus:bg-white/10 focus:text-white"
                          >
                            {device.label || `Microphone ${index + 1}`}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        disabled={
                          status === "connecting" || videoInputs.length === 0
                        }
                        className="w-full flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 disabled:opacity-50"
                      >
                        <Video size={14} className="text-white/60" />
                        <span className="shrink-0">Camera</span>
                        <span className="ml-auto min-w-0 truncate text-left">
                          {selectedCameraLabel}
                        </span>
                        <ChevronDown
                          size={14}
                          className="text-white/60 shrink-0"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-88 max-w-[calc(100vw-2rem)] bg-zinc-900 border-white/15 text-white"
                    >
                      <DropdownMenuLabel className="text-white/60">
                        Cameras
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-white/10" />
                      <DropdownMenuRadioGroup
                        value={selectedCameraId}
                        onValueChange={(value) => {
                          void handleCameraDeviceChange(value);
                        }}
                      >
                        <DropdownMenuRadioItem
                          value=""
                          className="text-white/85 focus:bg-white/10 focus:text-white"
                        >
                          System default camera
                        </DropdownMenuRadioItem>
                        {videoInputs.map((device, index) => (
                          <DropdownMenuRadioItem
                            key={device.deviceId}
                            value={device.deviceId}
                            className="text-white/85 focus:bg-white/10 focus:text-white"
                          >
                            {device.label || `Camera ${index + 1}`}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

            <div className="flex items-center justify-center gap-4">
              {(status === "idle" || status === "error") && (
                <button
                  onClick={startInterview}
                  disabled={!ownershipChecked}
                  className="flex items-center gap-2 bg-orange hover:bg-orange-500 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed text-white px-6 py-3 rounded-full font-medium transition-colors"
                >
                  {!ownershipChecked ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                  {!ownershipChecked ? "Verifying…" : "Start Interview"}
                </button>
              )}

              {status === "connecting" && (
                <button
                  disabled
                  className="flex items-center gap-2 bg-white/10 text-white/50 px-6 py-3 rounded-full font-medium cursor-not-allowed"
                >
                  <Loader2 size={18} className="animate-spin" />
                  Connecting…
                </button>
              )}

              {isActive && (
                <>
                  <button
                    onClick={toggleCamera}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors border ${cameraOn
                        ? "bg-orange/20 text-orange border-orange/40"
                        : "bg-white/10 text-white/80 border-white/10 hover:bg-white/15"
                      }`}
                    title={cameraOn ? "Disable webcam" : "Enable webcam"}
                  >
                    {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
                  </button>

                  <button
                    onClick={toggleMute}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors border ${!muted
                        ? "bg-orange/20 text-orange border-orange/40"
                        : "bg-white/10 text-white/80 border-white/10 hover:bg-white/15"
                      }`}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>

                  <button
                    onClick={() => setShowEndConfirm(true)}
                    className="flex items-center gap-2 bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/20 px-6 py-3 rounded-full font-medium"
                  >
                    <PhoneOff size={18} />
                    End Interview
                  </button>

                  <AlertDialog
                    open={showEndConfirm}
                    onOpenChange={setShowEndConfirm}
                  >
                    <AlertDialogContent className="bg-zinc-900 border-white/15 text-white max-w-sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">
                          End interview?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-white/55">
                          Are you sure you want to end this interview session?
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="bg-white/10 text-white/80 border-white/10 hover:bg-white/15 hover:text-white">
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-500/80 text-white hover:bg-red-500"
                          onClick={() => {
                            setShowEndConfirm(false);
                            void endInterview("candidate");
                          }}
                        >
                          End Interview
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}

              {status === "ended" && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => router.push("/dashboard")}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white/80 border border-white/10 px-5 py-3 rounded-full font-medium transition-colors"
                  >
                    Dashboard
                  </button>
                  {sessionId && !feedbackReady && (
                    <button
                      disabled
                      className="flex items-center gap-2 bg-white/10 text-white/50 px-6 py-3 rounded-full font-medium cursor-not-allowed"
                    >
                      <Loader2 size={16} className="animate-spin" />
                      Preparing…
                    </button>
                  )}
                  {sessionId && feedbackReady && (
                    <button
                      onClick={() =>
                        router.push(
                          `/interview/feedback?session_id=${encodeURIComponent(sessionId)}`,
                        )
                      }
                      className="flex items-center gap-2 bg-orange hover:bg-orange/85 text-white px-6 py-3 rounded-full font-medium transition-colors"
                    >
                      Get Feedback
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}