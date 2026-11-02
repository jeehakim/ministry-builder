import { useEffect, useRef } from "react";
import { btnCls, btnPrimaryCls } from "./ui";

export function PublishModal(props: { busy: boolean; error: string | null; onDownload: () => void; onClose: () => void }) {
  const { busy, error, onDownload, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // Unmounting removes the dialog from the top layer, so no cleanup is needed.
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="publish-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-full max-w-lg rounded-lg p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="space-y-4 p-6">
        <h2 id="publish-title" className="text-lg font-semibold text-slate-900">
          Publish your site for free
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Download the ZIP of your site.</li>
          <li>
            Go to{" "}
            <a className="text-sky-700 underline" href="https://cloudflare.com/drop" target="_blank" rel="noreferrer">
              cloudflare.com/drop
            </a>{" "}
            and drag the ZIP onto the page.
          </li>
          <li>Preview your site, then click Claim and create a free Cloudflare account to keep it.</li>
          <li>Later, add a custom domain to your site in the Cloudflare dashboard.</li>
        </ol>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnCls} onClick={onClose}>
            Close
          </button>
          <button type="button" className={btnPrimaryCls} disabled={busy} onClick={onDownload}>
            {busy ? "Preparing..." : "Download ZIP"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
