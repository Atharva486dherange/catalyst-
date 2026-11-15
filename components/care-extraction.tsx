"use client";

import type { User } from "firebase/auth";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiContracts, extractionReviewSchema } from "@/shared/contracts/api";
import type { ApiResponse } from "@/shared/contracts/api";
import { careRequest, messageFor, RequestError, useCareMutation } from "./care-client";

type Extraction = ApiResponse<"getExtraction">["data"];

export function PrescriptionExtractionSection({ user, path }: { user: User; path: string }) {
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Extraction | null>(null);
  const uploadKey = useRef<string | null>(null);
  const review = useCareMutation(user);
  const busy = uploading || review.pending;

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || busy) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    const file = body.get("file");
    setError("");
    setUnavailable(false);
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("Choose a prescription file up to 5 MiB.");
      return;
    }
    body.set("consent", "true");
    uploadKey.current ??= crypto.randomUUID();
    setUploading(true);
    try {
      const result = await careRequest(user, `${path}/prescription-extractions`, apiContracts.createExtraction.response, {
        method: "POST", key: uploadKey.current, body,
      });
      setDraft(result);
      form.reset();
      setConsent(false);
      uploadKey.current = null;
    } catch (error) {
      if (error instanceof RequestError && error.status === 503) setUnavailable(true);
      else setError(messageFor(error));
    } finally {
      setUploading(false);
    }
  }

  async function onSaveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const fields = new FormData(event.currentTarget);
    const payload = extractionReviewSchema.safeParse({
      items: draft.items.map((_, index) => ({
        name: fields.get(`name-${index}`),
        prescribedAmount: { value: fields.get(`amount-${index}`), unit: fields.get(`unit-${index}`) },
      })),
    });
    if (!payload.success) {
      setError("Check each medicine name, amount, and unit against the prescription.");
      return;
    }
    setError("");
    const saved = await review.run(`${path}/prescription-extractions/${draft.id}/review`, apiContracts.reviewExtraction.response, payload.data);
    if (saved) setDraft(saved);
  }

  return (
    <section className="surface">
      <h2>Prescription review</h2>
      <p>Use Gemini to transcribe a prescription, then verify the draft against the original.</p>
      {!open ? (
        <button className="secondary divided-action" type="button" onClick={() => setOpen(true)}>Upload prescription document</button>
      ) : (
        <>
          <form className="inline-form" onSubmit={onUpload}>
            <label>Prescription file (PDF, PNG, or JPEG, up to 5 MiB)
              <input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required disabled={busy}
                onChange={() => { uploadKey.current = null; }} />
            </label>
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} />
              I consent to AI-assisted prescription text extraction.
            </label>
            <div className="actions">
              <button type="submit" disabled={busy || !consent}>{uploading ? "Extracting…" : "Extract medicines with AI"}</button>
              <button className="secondary" type="button" disabled={busy} onClick={() => { setOpen(false); setConsent(false); uploadKey.current = null; }}>Close</button>
            </div>
          </form>
          {unavailable && <div className="empty" role="status">
            <strong>AI Extraction Unavailable</strong>
            <p>You can add a medicine manually under Manage care.</p>
          </div>}
          {draft?.state === "pending_review" && (draft.items.length > 0 ? (
            <form key={draft.id} className="inline-form divided" onSubmit={onSaveReview}>
              <h3>Review extracted candidates</h3>
              <p>Enter the confirmed amount and unit from the original prescription.</p>
              {draft.items.map((item, index) => <fieldset key={index} disabled={busy}>
                <legend>Medicine {index + 1}</legend>
                <p>Extracted amount: {item.amountText || "Unreadable"}</p>
                {item.scheduleText && <p>Extracted schedule: {item.scheduleText}</p>}
                <label>Medicine name<input name={`name-${index}`} defaultValue={item.name ?? ""} maxLength={120} required /></label>
                <div className="form-columns">
                  <label>Amount<input name={`amount-${index}`} inputMode="decimal" required /></label>
                  <label>Unit<input name={`unit-${index}`} maxLength={30} required /></label>
                </div>
              </fieldset>)}
              <button type="submit" disabled={busy}>Save reviewed draft</button>
            </form>
          ) : <p className="empty" role="status">No medicine fields were extracted. Add the medicine manually under Manage care.</p>)}
          {draft?.state === "reviewed" && <p className="notice" role="status">Prescription draft saved separately from active medication records.</p>}
          {(error || review.error) && <p className="error" role="alert">{error || review.error}</p>}
        </>
      )}
    </section>
  );
}
