"use client";

/* eslint-disable @next/next/no-img-element -- local object URL preview */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AvatarCropDialog } from "@/components/avatar-crop-dialog";
import { FormRenderer } from "@/components/rush/forms/form-renderer";
import { IuEmailWarning } from "@/components/rush/iu-email-warning";
import { AVATAR_ACCEPT, validateAvatarFile } from "@/lib/avatar-upload";
import { ApiError, errorMessage, rushFetch } from "@/lib/rush/client";
import { validateAnswers, type RushAnswers, type RushFormField } from "@/lib/rush/types";

type ApplicationInfo = {
  open: boolean;
  cycleLabel: string | null;
  template: { name: string; description: string; fields: RushFormField[] } | null;
  prefill: { name: string; email: string } | null;
  draft: { name: string; answers: RushAnswers; updatedAt: string } | null;
};

export default function ApplyPage() {
  const [info, setInfo] = useState<ApplicationInfo | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [answers, setAnswers] = useState<RushAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ hasAccount: boolean } | null>(null);
  const [resent, setResent] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const loadedDraft = useRef(false);
  // Drafts are only available when signed into a rush account.
  const canSaveDraft = Boolean(info?.prefill);

  const saveDraft = async (quiet = false) => {
    if (!canSaveDraft) return;
    setSavingDraft(true);
    try {
      const { savedAt: at } = await rushFetch<{ savedAt: string }>("/api/rush/apply/draft", {
        method: "PUT",
        json: { name, answers },
      });
      setSavedAt(at);
    } catch (err) {
      if (!quiet) setError(errorMessage(err));
    } finally {
      setSavingDraft(false);
    }
  };

  // Autosave a couple of seconds after the applicant stops typing.
  useEffect(() => {
    if (!canSaveDraft || result) return;
    if (!loadedDraft.current) {
      loadedDraft.current = true;
      return;
    }
    const timer = setTimeout(() => void saveDraft(true), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, name]);

  useEffect(() => {
    rushFetch<ApplicationInfo>("/api/rush/apply")
      .then((data) => {
        setInfo(data);
        if (data.prefill) {
          setName(data.prefill.name);
          setEmail(data.prefill.email);
        }
        if (data.draft) {
          setAnswers(data.draft.answers ?? {});
          if (data.draft.name) setName(data.draft.name);
          setSavedAt(data.draft.updatedAt);
        }
      })
      .catch(() => setInfo({ open: false, cycleLabel: null, template: null, prefill: null, draft: null }));
  }, []);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      setError(problem.replace("Profile pictures", "Photos"));
      return;
    }
    setError(null);
    setPickedFile(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info?.template) return;
    const errors = validateAnswers(info.template.fields, answers);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("Please answer the required questions.");
      return;
    }
    if (!photo) {
      setError("Add a headshot photo.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("name", name);
      form.set("email", email);
      form.set("website", website);
      form.set("answers", JSON.stringify(answers));
      form.set("photo", photo);
      const data = await rushFetch<{ hasAccount: boolean }>("/api/rush/apply", { method: "POST", body: form });
      setResult(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    await rushFetch("/api/rush/account/send-setup", { method: "POST", json: { email } }).catch(() => undefined);
    setResent(true);
  };

  return (
    <main className="bg-muted/30 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        {!info ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : result ? (
          <Card>
            <CardContent className="space-y-6 py-10 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
              <div className="space-y-2">
                <h1 className="text-2xl font-bold">Application submitted</h1>
                <p className="text-muted-foreground">
                  Thanks, {name.split(" ")[0]}! We sent a confirmation to {email}.
                </p>
              </div>
              {result.hasAccount ? (
                <Button asChild>
                  <Link href="/rush/portal">Go to your rush portal</Link>
                </Button>
              ) : (
                <div className="mx-auto max-w-md space-y-3 rounded-xl border bg-muted/40 p-5 text-left">
                  <p className="flex items-center gap-2 font-semibold">
                    <MailCheck className="h-5 w-5" /> Stay in touch: create your account
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Your confirmation email has a link to set a password. With an account you can see your rush events,
                    your attendance, and sign up for timeslots if you&apos;re invited to closed rush.
                  </p>
                  <Button variant="outline" size="sm" onClick={resend} disabled={resent}>
                    {resent ? "Link sent. Check your inbox." : "Email me the link again"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : !info.open || !info.template ? (
          <Card>
            <CardHeader>
              <CardTitle>Applications are closed</CardTitle>
              <CardDescription>
                The rush application isn&apos;t open right now. Check the rush page for upcoming events.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/rush">Rush info</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{info.cycleLabel}</p>
              <CardTitle className="text-3xl">Apply to Kappa Theta Pi</CardTitle>
              {info.template.description ? <CardDescription>{info.template.description}</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-6">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed bg-muted text-muted-foreground hover:border-primary"
                    aria-label="Upload headshot"
                  >
                    {photoPreview ? (
                      <img src={photoPreview} alt="Headshot preview" className="h-full w-full object-cover" />
                    ) : (
                      <Camera className="h-7 w-7" />
                    )}
                  </button>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Headshot <span className="text-destructive">*</span>
                    </p>
                    <p className="text-xs text-muted-foreground">A clear photo of your face. JPEG, PNG or WebP, up to 4MB.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                      {photo ? "Change photo" : "Upload photo"}
                    </Button>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={AVATAR_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      pickPhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Full name <span className="text-destructive">*</span>
                    </Label>
                    <Input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      IU email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@iu.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <IuEmailWarning email={email} />

                <FormRenderer fields={info.template.fields} values={answers} onChange={setAnswers} errors={fieldErrors} publicMode />

                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="hidden"
                  aria-hidden="true"
                  name="website"
                />

                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={submitting}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Submit application
                  </Button>
                  {canSaveDraft ? (
                    <>
                      <Button type="button" variant="outline" size="lg" disabled={savingDraft} onClick={() => void saveDraft()}>
                        {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save draft
                      </Button>
                      {savedAt ? (
                        <span className="text-xs text-muted-foreground">
                          Draft saved {new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          . Your photo isn&apos;t saved with drafts.
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      <Link href="/rush/portal" className="underline">
                        Sign in to your rush account
                      </Link>{" "}
                      to save your progress.
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      <AvatarCropDialog
        open={Boolean(pickedFile)}
        file={pickedFile}
        onOpenChange={(open) => {
          if (!open) setPickedFile(null);
        }}
        onConfirm={(cropped) => {
          setPhoto(cropped);
          setPickedFile(null);
        }}
      />
    </main>
  );
}
