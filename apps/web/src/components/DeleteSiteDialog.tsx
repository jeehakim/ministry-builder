import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBackend } from "../backend-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface DeletableSite {
  id: string;
  orgName: string;
  publishedUrl: string | null;
}

/** Confirm-and-delete flow shared by the site list and the site settings. Open while `site` is set. */
export function DeleteSiteDialog(props: { site: DeletableSite | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const { site, onClose, onDeleted } = props;
  const backend = useBackend();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!site || !backend.deleteSite) return;
    setDeleting(true);
    try {
      await backend.deleteSite(site.id);
      toast.success(`Deleted ${site.orgName}`, { description: "The site, its images, messages and published pages are gone." });
      onDeleted(site.id);
    } catch (err) {
      toast.error("Could not delete the site", { description: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={site !== null} onOpenChange={(o) => !o && !deleting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {site?.orgName}?</DialogTitle>
          <DialogDescription>
            This removes the site, every saved version, uploaded images, contact messages and the published pages
            {site?.publishedUrl ? ` at ${site.publishedUrl}` : ""}. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={deleting} onClick={onClose}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {deleting ? "Deleting…" : "Delete site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
