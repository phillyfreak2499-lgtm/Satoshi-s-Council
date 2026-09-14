import { useEffect, useMemo, useState } from "react";
import { listBoard, postBoard, type BoardKind, type BoardPost } from "@/lib/desk/board";
import { gtagEventAfterSuccess } from "@/lib/desk/ga";
import { getAdminKey, type DeskFrame } from "@/lib/desk/engine";
import { fmtLocal } from "@/lib/desk/market-hours";
import { cn } from "@/lib/utils";
import { LeanChip } from "./bits";
import { SEEN_KEY } from "./use-board-unread";

const WHO_KEY = "satoshi-desk-v1-board-who";
const PAGE_SIZE = 6;

function pageCount(rows: BoardPost[]): number {
  return Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
}

function pageRows(rows: BoardPost[], page: number): BoardPost[] {
  return rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

function BoardPager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Board pages">
      <button
        type="button"
        className="btn btn-sm text-muted hover:text-fg"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        ← Newer
      </button>
      <span className="font-mono text-micro tabular text-subtle">
        page {page + 1} / {pages}
      </span>
      <button
        type="button"
        className="btn btn-sm text-muted hover:text-fg"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        Older →
      </button>
    </nav>
  );
}

function loadWho() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(WHO_KEY) ?? "";
  } catch {
    return "";
  }
}

function tape(frame: DeskFrame) {
  return {
    lean: frame.chair?.lean ?? "",
    ticker: frame.snap?.ticker ?? "",
    conf: frame.chair?.confidence ?? 0,
  };
}

function PostCard({
  p,
  tz,
  replies,
  onReply,
}: {
  p: BoardPost;
  tz: string;
  replies?: BoardPost[];
  onReply?: (id: number) => void;
}) {
  return (
    <article className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-micro text-fg">{p.who}</span>
        <span className="font-mono text-micro tabular text-subtle">{fmtLocal(p.t, tz)}</span>
      </div>
      <p className="mt-1 font-sans text-body text-fg">{p.body}</p>
      {(p.lean || p.ticker) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.lean === "UP" || p.lean === "DOWN" || p.lean === "WAIT" ? <LeanChip lean={p.lean} /> : null}
          {p.conf ? <span className="font-mono text-micro text-subtle">{p.conf} conf</span> : null}
          {p.ticker ? <span className="truncate font-mono text-micro text-subtle">{p.ticker}</span> : null}
        </div>
      )}
      {onReply ? (
        <button
          type="button"
          onClick={() => onReply(p.id)}
          className="mt-2 min-h-11 font-mono text-micro text-muted hover:text-fg sm:min-h-0"
        >
          Reply
        </button>
      ) : null}
      {replies && replies.length > 0 ? (
        <ul className="mt-2 space-y-2 border-l border-border pl-3">
          {replies.map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-micro text-fg">{r.who}</span>
                <span className="font-mono text-micro tabular text-subtle">{fmtLocal(r.t, tz)}</span>
              </div>
              <p className="mt-0.5 font-sans text-ui text-fg">{r.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function Composer({
  frame,
  kind,
  parentId,
  onPosted,
  onCancel,
}: {
  frame: DeskFrame;
  kind: BoardKind;
  parentId: number | null;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const [who, setWho] = useState(loadWho);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const send = async () => {
    const body = note.trim();
    if (!body || busy) return;
    setBusy(true);
    setStatus("");
    try {
      localStorage.setItem(WHO_KEY, who.trim().slice(0, 24));
      const post = async () => {
        await postBoard({
          data: {
            who: kind === "update" && !who.trim() ? "DESK" : who,
            body,
            kind,
            parent_id: parentId,
            ...tape(frame),
            ...(kind === "update" ? { admin_key: getAdminKey() } : {}),
          },
        });
      };
      // Desk updates are admin ops — not visitor feedback. Idea/feedback only,
      // and only after postBoard succeeds.
      if (kind === "idea" || kind === "feedback") {
        await gtagEventAfterSuccess("feedback_submitted", post);
      } else {
        await post();
      }
      setNote("");
      onPosted();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <input
        value={who}
        onChange={(e) => setWho(e.target.value)}
        className="input input-sm w-full font-mono"
        placeholder="your name"
        maxLength={24}
        autoComplete="nickname"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={parentId ? 2 : 4}
        maxLength={400}
        className="input w-full resize-y font-sans"
        placeholder={
          parentId
            ? "Feedback on this idea"
            : kind === "idea"
              ? "An idea for the desk or a bot"
              : kind === "update"
                ? "What changed on the desk, in plain words"
                : "Feedback on the tape"
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !note.trim()}
          className="btn btn-secondary btn-sm"
        >
          {kind === "idea" ? "Post idea" : kind === "update" ? "Post update" : "Post feedback"}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 font-mono text-micro text-muted hover:text-fg sm:min-h-0"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {status ? <p className="font-mono text-micro text-wait">{status}</p> : null}
    </form>
  );
}

export function BoardTab({ frame }: { frame: DeskFrame }) {
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [kind, setKind] = useState<BoardKind>("idea");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [updatePage, setUpdatePage] = useState(0);
  const [ideaPage, setIdeaPage] = useState(0);
  const [feedbackPage, setFeedbackPage] = useState(0);
  const tz = frame.settings.tz || "America/Chicago";

  const pull = async () => {
    try {
      const rows = await listBoard();
      setPosts(rows);
      setErr("");
      localStorage.setItem(SEEN_KEY, String(rows.length));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Board is down.");
    }
  };

  useEffect(() => {
    void pull();
    const t = window.setInterval(() => void pull(), 8000);
    return () => window.clearInterval(t);
  }, []);

  const updates = useMemo(() => posts.filter((p) => p.kind === "update" && !p.parent_id), [posts]);
  const ideas = useMemo(() => posts.filter((p) => p.kind === "idea" && !p.parent_id), [posts]);
  const notes = useMemo(() => posts.filter((p) => p.kind === "feedback" && !p.parent_id), [posts]);
  const newestUpdates = useMemo(() => updates.slice().reverse(), [updates]);
  const newestIdeas = useMemo(() => ideas.slice().reverse(), [ideas]);
  const newestNotes = useMemo(() => notes.slice().reverse(), [notes]);
  const admin = Boolean(getAdminKey());
  const kids = useMemo(() => {
    const m = new Map<number, BoardPost[]>();
    for (const p of posts) {
      if (p.parent_id == null) continue;
      const list = m.get(p.parent_id) ?? [];
      list.push(p);
      m.set(p.parent_id, list);
    }
    return m;
  }, [posts]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <h2 className="font-sans text-title font-medium tracking-tight">Ideas & feedback</h2>
        <p className="mt-1 max-w-xl font-mono text-micro text-muted">
          One shared board. Post an idea. Reply with feedback. The call you were looking at rides
          along. DESK posts an update here whenever the floor changes. Paper talk only.
        </p>
      </div>

      <section className="rounded-md border border-border bg-surface p-3">
        <div className="mb-2 flex gap-1">
          {(
            [
              ["idea", "Idea"],
              ["feedback", "Feedback"],
              ...(admin ? ([["update", "Update"]] as const) : []),
            ] as readonly (readonly [BoardKind, string])[]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className={cn(
                "min-h-11 rounded-sm px-3 py-1.5 font-mono text-micro sm:min-h-0",
                kind === id ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Composer frame={frame} kind={kind} parentId={null} onPosted={() => void pull()} />
      </section>

      {err ? <p className="font-mono text-micro text-wait">{err}</p> : null}

      {updates.length > 0 ? (
        <details className="rounded-md border border-border bg-canvas">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 font-mono text-micro uppercase tracking-widest text-subtle marker:content-none">
            <span>Desk updates · {updates.length}</span>
            <span aria-hidden="true">▸</span>
          </summary>
          <div className="border-t border-border p-3">
            <div className="space-y-3">
              {pageRows(newestUpdates, updatePage).map((p) => (
                <div key={p.id}>
                  <PostCard p={p} tz={tz} replies={kids.get(p.id)} onReply={(id) => setReplyTo(id)} />
                  {replyTo === p.id ? (
                    <div className="p-3 pt-0">
                      <Composer
                        frame={frame}
                        kind="feedback"
                        parentId={p.id}
                        onPosted={() => {
                          setReplyTo(null);
                          void pull();
                        }}
                        onCancel={() => setReplyTo(null)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <BoardPager page={updatePage} pages={pageCount(newestUpdates)} onPage={setUpdatePage} />
          </div>
        </details>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">Ideas · {ideas.length}</h3>
          {!ideas.length ? (
            <p className="font-mono text-micro text-muted">No ideas yet. First one on the tape.</p>
          ) : (
            <div className="space-y-3">
              {pageRows(newestIdeas, ideaPage).map((p) => (
                  <div key={p.id}>
                    <PostCard p={p} tz={tz} replies={kids.get(p.id)} onReply={(id) => setReplyTo(id)} />
                    {replyTo === p.id ? (
                      <div className="mt-2 pl-3">
                        <Composer
                          frame={frame}
                          kind="feedback"
                          parentId={p.id}
                          onPosted={() => {
                            setReplyTo(null);
                            void pull();
                          }}
                          onCancel={() => setReplyTo(null)}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              <BoardPager page={ideaPage} pages={pageCount(newestIdeas)} onPage={setIdeaPage} />
            </div>
          )}
        </section>
        <section>
          <h3 className="mb-2 font-mono text-micro uppercase tracking-widest text-subtle">Feedback · {notes.length}</h3>
          {!notes.length ? (
            <p className="font-mono text-micro text-muted">No open feedback yet. Reply on an idea, or post Feedback above.</p>
          ) : (
            <div className="space-y-3">
              {pageRows(newestNotes, feedbackPage).map((p) => (
                <PostCard key={p.id} p={p} tz={tz} />
              ))}
              <BoardPager page={feedbackPage} pages={pageCount(newestNotes)} onPage={setFeedbackPage} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
