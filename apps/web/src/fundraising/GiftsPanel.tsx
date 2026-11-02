import { useRef, useState, type FormEvent } from "react";
import { formatMoney, parseAmountToCents, type CampaignTotals, type Gift, type GiftImportResponse, type GiftInput } from "@ministry/schema";
import { AlertCircle, Download, FileUp, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FundraisingBackend } from "../backend";
import { giftCsvTemplate } from "../lib/fundraising";
import { downloadBlob } from "../lib/exportZip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function thankYouStatus(gift: Gift): { label: string; detail: string | null; variant: "secondary" | "outline" | "destructive" } {
  if (gift.thankYouSentAt) return { label: "Thanked", detail: null, variant: "secondary" };
  if (gift.thankYouError) return { label: "Email failed", detail: gift.thankYouError, variant: "destructive" };
  if (!gift.donorEmail) return { label: "No email", detail: null, variant: "outline" };
  return { label: "Not emailed", detail: "No sender is configured, or the gift was imported. Imported gifts never trigger an email.", variant: "outline" };
}

/** The gifts of a campaign: a table with add, CSV import and delete. Totals come from the server after every change. */
export function GiftsPanel(props: {
  fundraising: FundraisingBackend;
  siteId: string;
  campaignId: string;
  currency: string;
  gifts: Gift[];
  totals: CampaignTotals;
  onChange: (gifts: Gift[], totals: CampaignTotals) => void;
}) {
  const { fundraising, siteId, campaignId, currency, gifts, totals, onChange } = props;
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function remove(gift: Gift) {
    setDeleting(gift.id);
    try {
      const next = await fundraising.removeGift(siteId, campaignId, gift.id);
      onChange(
        gifts.filter((g) => g.id !== gift.id),
        next,
      );
      toast.success("Gift removed");
    } catch (err) {
      toast.error("Could not remove the gift", { description: errorText(err) });
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  async function reload() {
    try {
      const list = await fundraising.listGifts(siteId, campaignId);
      onChange(list.gifts, list.totals);
    } catch (err) {
      toast.error("Could not refresh the gifts", { description: errorText(err) });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Gifts</CardTitle>
          <CardDescription>
            {totals.giftCount === 0 ? "Nothing recorded yet." : `${totals.giftCount} ${totals.giftCount === 1 ? "gift" : "gifts"}, ${formatMoney(totals.raisedAmount, totals.currency)} in total.`} Record what came
            through your processor or by hand; the page shows the total on the next publish.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setImporting(true)}>
            <FileUp />
            Import CSV
          </Button>
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add gift
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {gifts.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No gifts yet. Add one by hand or import a CSV from your processor.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Received</th>
                  <th className="py-2 pr-3 font-medium">Donor</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Wall</th>
                  <th className="py-2 pr-3 font-medium">Thank-you</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => {
                  const status = thankYouStatus(g);
                  return (
                    <tr key={g.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{new Date(g.receivedAt).toLocaleDateString()}</td>
                      <td className="py-2 pr-3">
                        <span className="block">{g.donorName || <span className="text-muted-foreground">Anonymous</span>}</span>
                        {g.donorEmail ? <span className="block text-xs text-muted-foreground">{g.donorEmail}</span> : null}
                        {g.note ? <span className="block text-xs text-muted-foreground">{g.note}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums whitespace-nowrap">{formatMoney(g.amountCents, g.currency)}</td>
                      <td className="py-2 pr-3 capitalize">{g.source}</td>
                      <td className="py-2 pr-3">{g.public ? "Listed" : "Private"}</td>
                      <td className="py-2 pr-3">
                        {status.detail ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant={status.variant} tabIndex={0}>
                                {status.variant === "destructive" ? <AlertCircle aria-hidden="true" /> : <Mail aria-hidden="true" />}
                                {status.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                              {status.detail}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant={status.variant}>{status.label}</Badge>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {confirming === g.id ? (
                          <span className="inline-flex items-center gap-1" role="group" aria-label="Confirm delete">
                            <Button type="button" variant="destructive" size="xs" disabled={deleting === g.id} onClick={() => void remove(g)}>
                              {deleting === g.id ? <Loader2 className="animate-spin" /> : null}
                              Delete
                            </Button>
                            <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(null)}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Delete gift of ${formatMoney(g.amountCents, g.currency)}`} onClick={() => setConfirming(g.id)}>
                            <Trash2 />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <AddGiftDialog
        open={adding}
        currency={currency}
        onOpenChange={setAdding}
        onSubmit={async (input) => {
          const result = await fundraising.addGift(siteId, campaignId, input);
          onChange([result.gift, ...gifts], result.totals);
          const thanked = result.gift.thankYouSentAt ? " Thank-you email sent." : "";
          toast.success(`Recorded ${formatMoney(result.gift.amountCents, result.gift.currency)}.${thanked}`);
        }}
      />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        onImport={async (csv) => {
          const result = await fundraising.importGifts(siteId, campaignId, csv);
          if (result.errors.length === 0) {
            toast.success(`Imported ${result.imported} ${result.imported === 1 ? "gift" : "gifts"}`);
            await reload();
          }
          return result;
        }}
      />
    </Card>
  );
}

function AddGiftDialog(props: { open: boolean; currency: string; onOpenChange: (open: boolean) => void; onSubmit: (input: GiftInput) => Promise<void> }) {
  const { open, currency, onOpenChange, onSubmit } = props;
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<GiftInput["source"]>("external");
  const [isPublic, setIsPublic] = useState(false);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setAmount("");
    setName("");
    setEmail("");
    setSource("external");
    setIsPublic(false);
    setNote("");
    setDate("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const amountCents = parseAmountToCents(amount);
    if (amountCents === null) {
      setError("Enter an amount such as 25 or 12.50.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        amountCents,
        source,
        donorName: name.trim(),
        donorEmail: email.trim(),
        public: isPublic,
        note: note.trim(),
        ...(date ? { receivedAt: new Date(`${date}T12:00:00Z`).toISOString() } : {}),
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>Record a gift</DialogTitle>
            <DialogDescription>A gift that came through your processor or by cash or check. With an email address, the donor gets your thank-you note.</DialogDescription>
          </DialogHeader>
          <div className="my-4 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gift-amount">Amount ({currency})</Label>
                <Input id="gift-amount" autoFocus inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gift-date">Received</Label>
                <Input id="gift-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gift-name">Donor name</Label>
              <Input id="gift-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Maria Lopez" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gift-email">Donor email (optional)</Label>
              <Input id="gift-email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} placeholder="maria@example.org" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gift-source">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v === "offline" ? "offline" : "external")}>
                <SelectTrigger id="gift-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">Through the giving link (Zeffy, Givebutter, PayPal…)</SelectItem>
                  <SelectItem value="offline">Offline (cash, check)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              <span>
                <span className="block font-medium">The donor agreed to be listed on the donor wall</span>
                <span className="block text-xs text-muted-foreground">Shown as first name and initial, such as "Maria L.", when the wall is on.</span>
              </span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="gift-note">Note (private)</Label>
              <Textarea id="gift-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Check #1042" />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              {busy ? "Saving…" : "Record gift"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onImport: (csv: string) => Promise<GiftImportResponse> }) {
  const { open, onOpenChange, onImport } = props;
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GiftImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(file: File) {
    setFileName(file.name);
    setCsv(await file.text());
    setResult(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!csv.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await onImport(csv);
      setResult(outcome);
      if (outcome.errors.length === 0) {
        setCsv("");
        setFileName(null);
        onOpenChange(false);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>Import gifts from a CSV</DialogTitle>
            <DialogDescription>
              Columns: amount (required), name, email, date, source (external or offline), public (yes/no), note. Up to 2,000 rows per file. Nothing is imported if any row has
              a problem, and imported gifts get no thank-you email.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                <FileUp />
                Choose file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void pick(file);
                }}
              />
              {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
              <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => downloadBlob(new Blob([giftCsvTemplate()], { type: "text/csv" }), "gifts-template.csv")}>
                <Download />
                Template
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gift-csv">Or paste the CSV</Label>
              <Textarea
                id="gift-csv"
                rows={6}
                className="font-mono text-xs"
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setResult(null);
                }}
                placeholder={"amount,name,email,date\n25,Maria Lopez,maria@example.org,2026-01-15"}
              />
            </div>
            {result && result.errors.length > 0 ? (
              <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <p className="font-medium">Fix these rows and try again. Nothing was imported.</p>
                <ul className="list-disc pl-5">
                  {result.errors.slice(0, 10).map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      {e.row > 0 ? `Row ${e.row}: ` : ""}
                      {e.message}
                    </li>
                  ))}
                  {result.errors.length > 10 ? <li>…and {result.errors.length - 10} more</li> : null}
                </ul>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !csv.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
              {busy ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
