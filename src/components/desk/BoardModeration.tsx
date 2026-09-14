import { useState } from "react";
import { listBoardModeration, moderateBoard, type ModerationPost } from "@/lib/desk/board";
import { getAdminKey } from "@/lib/desk/engine";

export function BoardModeration({ onChanged }: { onChanged: () => void }) {
  const [posts, setPosts] = useState<ModerationPost[]>([]);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setPosts(await listBoardModeration({ data: { admin_key: getAdminKey() } }));
  const load = async () => {
    setBusy(true);
    try { await refresh(); setStatus("Showing the latest 120 posts, including hidden posts."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not load moderation."); }
    finally { setBusy(false); }
  };
  const change = async (post: ModerationPost) => {
    setBusy(true);
    try {
      await moderateBoard({ data: { admin_key: getAdminKey(), id: post.id, hidden: !post.hidden, reason } });
      onChanged();
      await refresh();
      setStatus(post.hidden ? "Post restored." : "Post hidden. Replies are hidden with their parent.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not moderate this post."); }
    finally { setBusy(false); }
  };
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="min-h-11 cursor-pointer font-mono text-ui">Desk moderation</summary>
      <p className="my-2 font-mono text-micro text-muted">Hide or restore posts. Original text is retained and every change records a reason.</p>
      <button type="button" disabled={busy} className="btn btn-secondary" onClick={() => void load()}>Load / refresh posts</button>
      <label className="mt-3 block font-mono text-micro">Reason for the next change
        <input className="input mt-1 w-full" maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. spam, harassment, restored after review" />
      </label>
      <p role="status" className="my-2 font-mono text-micro text-muted">{status}</p>
      <ul className="max-h-96 space-y-2 overflow-y-auto">
        {posts.map((post) => (
          <li key={post.id} className="rounded border border-border p-2 font-mono text-micro">
            <p>{post.who} · #{post.id} · {post.hidden ? "hidden" : "visible"}{post.parent_id ? ` · reply to #${post.parent_id}` : ""}</p>
            <p className="my-1 whitespace-pre-wrap break-words font-sans text-ui">{post.body}</p>
            {post.moderation_reason ? <p className="text-subtle">Last reason: {post.moderation_reason}</p> : null}
            <button type="button" className="btn btn-sm" disabled={busy || !reason.trim()} onClick={() => void change(post)}>{post.hidden ? "Restore post" : "Hide post"}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
