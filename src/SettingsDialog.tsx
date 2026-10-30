import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Dialogs";
import { CLAUDE_CODE_URL, signInChatGPT, USAGE_URL, type AiProvider } from "./ai";
import { updateSummary } from "./updates";
import { clearOcrCache, ocrCacheBytes } from "./ocr/cache";
import { OCR_MODELS } from "./ocr/constants";
import { ocrEnabled, ocrLanguage, setOcrEnabled, setOcrLanguage } from "./ocr/settings";

/** One place for every Folio preference. */
interface Props {
  theme: string;
  onTheme: (theme: "light" | "dark") => void;
  night: boolean;
  onNight: (on: boolean) => void;
  onOpenChangelog: () => void;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; name: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented small" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function OcrSettings({ onError }: { onError: (message: string | null) => void }) {
  const desktop = window.folioDesktop?.ocr;
  const [enabled, setEnabled] = useState(ocrEnabled);
  const [lang, setLang] = useState(ocrLanguage);
  const [present, setPresent] = useState<Record<string, boolean>>({ eng: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ocrCacheBytes().then((n) => { if (!cancelled) setCacheBytes(n); }).catch(() => {});
    if (!desktop) return () => { cancelled = true; };
    void Promise.all(Object.entries(OCR_MODELS).filter(([, model]) => !model.bundled).map(async ([code]) => {
      const status = await desktop.modelStatus(code);
      return [code, status.present] as const;
    })).then((rows) => {
      if (!cancelled) setPresent((current) => ({ ...current, ...Object.fromEntries(rows) }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [desktop]);

  return (
    <Section title="Scanned pages">
      <Row label="Read scanned pages" hint="On this computer. Page images are not uploaded. Ask AI sends the text only when you ask a question.">
        <Switch label="Read scanned pages" checked={enabled} onChange={(on) => { setEnabled(on); setOcrEnabled(on); }} />
      </Row>
      {Object.entries(OCR_MODELS).map(([code, model]) => {
        const ready = model.bundled || !!present[code];
        const hint = model.bundled
          ? "Included with Folio."
          : ready
            ? "Saved on this computer."
            : desktop
              ? `Download ${formatBytes(model.bytes)}. Folio checks the file before saving it.`
              : "Downloads in the desktop app.";
        return (
          <Row key={code} label={model.name} hint={hint}>
            {ready ? (
              <button className="btn ghost" disabled={lang === code} onClick={() => { setLang(code); setOcrLanguage(code); }}>{lang === code ? "In use" : "Use"}</button>
            ) : desktop ? (
              <button className="btn ghost" disabled={busy !== null} onClick={async () => {
                setBusy(code);
                onError(null);
                const result = await desktop.fetchModel(code);
                setBusy(null);
                if (!result.ok) { onError(result.error); return; }
                setPresent((current) => ({ ...current, [code]: true }));
                setLang(code);
                setOcrLanguage(code);
              }}>{busy === code ? "Downloading…" : `Download ${formatBytes(model.bytes)}`}</button>
            ) : (
              <button className="btn ghost" disabled>Desktop app</button>
            )}
          </Row>
        );
      })}
      <Row label="OCR cache" hint={cacheBytes === null ? "Recognized text stored on this computer. Password-protected PDFs are not stored." : `${formatBytes(cacheBytes)} stored, up to 200 MB. Password-protected PDFs are not stored.`}>
        <button className="btn ghost" disabled={!cacheBytes} onClick={async () => {
          onError(null);
          try { await clearOcrCache(); setCacheBytes(0); }
          catch { onError("Couldn't clear the OCR cache. Please try again."); }
        }}>Clear</button>
      </Row>
    </Section>
  );
}

export function SettingsDialog({ theme, onTheme, night, onNight, onOpenChangelog, onClose }: Props) {
  const desktop = window.folioDesktop;
  const ai = desktop?.ai;
  const [error, setError] = useState<string | null>(null);

  // Updates
  const [info, setInfo] = useState<Awaited<ReturnType<FolioDesktop["getAppInfo"]>> | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    desktop.getAppInfo().then((i) => { if (!cancelled) setInfo(i); }).catch(() => {});
    desktop.getAutoUpdateEnabled().then((on) => { if (!cancelled) setAutoUpdate(on); }).catch(() => {});
    const unsubscribe = desktop.onUpdateStatus(setStatus);
    return () => { cancelled = true; unsubscribe?.(); };
  }, [desktop]);
  // Installed Windows copies and Linux AppImages update themselves; Macs check and offer the download.
  const updatable = info?.mode === "installed" || info?.mode === "appimage";
  // Unsigned Mac builds only announce updates (with a download link); signed ones install them.
  const notifyOnly = !!info?.notifyOnly;

  // Ask AI
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState(() => localStorage.getItem("folio:ai-provider") || "chatgpt");
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => { void ai?.status().then(setAiStatus).catch(() => {}); }, [ai]);

  // Signature
  const [savedSignature, setSavedSignature] = useState(() => {
    try { return !!localStorage.getItem("folio:signature"); } catch { return false; }
  });

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <Section title="Appearance">
          <Row label="Theme">
            <Choice label="Theme" value={theme === "dark" ? "dark" : "light"} onChange={onTheme}
              options={[{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }]} />
          </Row>
          <Row label="Night reading" hint="Dims bright pages for reading in the dark. Images keep their colors.">
            <Switch label="Night reading" checked={night} onChange={onNight} />
          </Row>
        </Section>

        {desktop && (
          <Section title="Ask AI">
            <Row label="Default provider" hint="Which assistant Ask AI opens with.">
              <Choice label="Default provider" value={provider as AiProvider}
                onChange={(p) => { setProvider(p); localStorage.setItem("folio:ai-provider", p); }}
                options={[{ id: "chatgpt", name: "ChatGPT" }, { id: "claude", name: "Claude" }]} />
            </Row>
            <Row
              label="ChatGPT"
              hint={!aiStatus ? "Checking…" : aiStatus.chatgpt.connected
                ? <>Signed in{aiStatus.chatgpt.email ? ` as ${aiStatus.chatgpt.email}` : ""}. Uses your ChatGPT plan · <a href={USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a></>
                : "Use your ChatGPT plan (Go, Plus, or Pro). No API key needed."}
            >
              {aiStatus?.chatgpt.connected ? (
                <button className="btn ghost" onClick={async () => setAiStatus({ ...aiStatus, chatgpt: await ai!.signOutChatGPT() })}>Sign out</button>
              ) : (
                <button className="btn primary" disabled={!aiStatus || signingIn} onClick={async () => {
                  setSigningIn(true);
                  setError(null);
                  const result = await signInChatGPT(ai!);
                  setSigningIn(false);
                  setError(result.error);
                  setAiStatus(result.status);
                }}>{signingIn ? "Waiting for browser…" : "Continue with ChatGPT"}</button>
              )}
            </Row>
            <Row
              label="Claude"
              hint={!aiStatus ? "Checking…" : !aiStatus.claude.installed
                ? <>Uses your Claude subscription through <a href={CLAUDE_CODE_URL} target="_blank" rel="noreferrer">Claude Code</a>. Install it and sign in once.</>
                : aiStatus.claude.loggedIn
                  ? `Claude Code ${aiStatus.claude.version ?? ""} is signed in${aiStatus.claude.subscription ? " with your Claude subscription" : ""}.`
                  : "Claude Code is installed but not signed in. Run claude in a terminal and sign in."}
            >
              <button className="btn ghost" disabled={!aiStatus} onClick={async () => setAiStatus({ ...aiStatus!, claude: await ai!.recheckClaude() })}>Check again</button>
            </Row>
          </Section>
        )}

        <OcrSettings onError={setError} />

        <Section title="Signature">
          <Row label="Remembered signature" hint={savedSignature
            ? "Saved on this computer (unencrypted) for quick signing."
            : "None. You can choose to remember one when you sign a document."}>
            <button className="btn ghost" disabled={!savedSignature} onClick={() => {
              try { localStorage.removeItem("folio:signature"); setSavedSignature(false); }
              catch { setError("Couldn't forget the signature. Please try again."); }
            }}>Forget</button>
          </Row>
        </Section>

        {desktop && (
          <Section title="Updates">
            {updatable && (
              <Row label="Automatic updates" hint={autoUpdate === false
                ? "Off: no background checks or downloads. You can still check manually."
                : notifyOnly
                  ? "Folio checks for new versions and lets you know; download them from the releases page."
                  : "Downloads updates in the background and installs them when Folio closes."}>
                <Switch label="Automatic updates" checked={autoUpdate === true} disabled={autoUpdate === null || savingUpdate} onChange={async (on) => {
                  setSavingUpdate(true);
                  setError(null);
                  try { setAutoUpdate(await desktop.setAutoUpdateEnabled(on)); }
                  catch { setError("Couldn't save the update setting. Try again."); }
                  finally { setSavingUpdate(false); }
                }} />
              </Row>
            )}
            <Row label={`Folio ${info?.version ?? ""}`.trim()} hint={updateSummary(status) || (status.checkedAt ? `Last checked ${new Date(status.checkedAt).toLocaleString()}` : undefined)}>
              {updatable ? (
                <button className="btn ghost" disabled={status.state === "checking" || status.state === "downloading"}
                  onClick={() => status.state === "ready" ? desktop.installUpdate() : status.state === "available" ? void desktop.openDownload() : desktop.checkForUpdates()}>
                  {status.state === "ready" ? "Restart and update" : status.state === "available" ? `Download ${status.version}` : "Check for updates"}
                </button>
              ) : null}
            </Row>
          </Section>
        )}

        <Section title="About">
          <Row label="What's new" hint="Changes in each version of Folio.">
            <button className="btn ghost" onClick={onOpenChangelog}>View changelog</button>
          </Row>
        </Section>

        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}
