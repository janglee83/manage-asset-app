/**
 * WelcomeGuide — onboarding modal with step-by-step navigation.
 *
 * Modes:
 *  - Overview (activeStep === null): 2×2 grid of all steps, CTA to add folder.
 *  - Step detail (activeStep 0–3): full-screen explanation for one step with
 *    prev/next navigation.  Opened by clicking a step card in overview OR by
 *    passing `initialStep` from the header Help button.
 *
 * Each step detail includes an animated live demo so the user can see what
 * the feature actually looks like in motion.
 */

import { useState, useEffect, useRef } from "react";
import { FolderPlus, Search, ScanSearch, Wand2, ChevronLeft, ChevronRight, X, BookOpen,
         FileImage, File, Tag } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAssetStore } from "../store/assetStore";
import { useT, useLang } from "../lib/i18n";

const STEP_ICONS = [FolderPlus, Search, ScanSearch, Wand2];

// ── Animated demos ─────────────────────────────────────────────────────────────

/** Step 0: A sidebar folder appears, then a grid of files populates. */
function Demo0() {
  const [phase, setPhase] = useState(0); // 0=empty 1=folder 2=files
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 600);
    const t2 = setTimeout(() => setPhase(2), 1400);
    const t3 = setTimeout(() => setPhase(0), 4200);
    const t4 = setTimeout(() => setPhase(1), 4800);
    const t5 = setTimeout(() => setPhase(2), 5600);
    return () => [t1,t2,t3,t4,t5].forEach(clearTimeout);
  }, []);
  const files = ["img_001.png","photo.jpg","icon.svg","banner.webp","logo.png","cover.jpg"];
  return (
    <div className="flex h-28 rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900 text-[9px]">
      {/* Sidebar */}
      <div className="w-24 shrink-0 bg-slate-800/60 border-r border-slate-700/40 p-2 flex flex-col gap-1">
        <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-1">Folders</p>
        <div className={`flex items-center gap-1 px-1 py-0.5 rounded transition-all duration-500 ${phase >= 1 ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"}`}>
          <FolderPlus size={9} className="text-yellow-500 shrink-0" />
          <span className="text-slate-300 truncate">Downloads</span>
        </div>
        <div className={`h-1 rounded-full bg-violet-500/40 mt-1 overflow-hidden transition-all duration-700 ${phase >= 1 ? "opacity-100" : "opacity-0"}`}>
          <div className={`h-full bg-violet-500 rounded-full transition-all duration-[1200ms] ${phase >= 2 ? "w-full" : "w-0"}`} />
        </div>
      </div>
      {/* Grid */}
      <div className="flex-1 p-2 grid grid-cols-3 gap-1.5 content-start">
        {files.map((name, i) => (
          <div
            key={name}
            className={`bg-slate-800 rounded border border-slate-700/50 flex flex-col items-center justify-center gap-0.5 p-1 transition-all duration-300`}
            style={{ transitionDelay: `${i * 80}ms`, opacity: phase >= 2 ? 1 : 0, transform: phase >= 2 ? "scale(1)" : "scale(0.8)" }}
          >
            <FileImage size={10} className="text-violet-400" />
            <span className="text-slate-500 truncate w-full text-center" style={{fontSize:7}}>{name.split(".")[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 1: A search bar types out a query and results appear. */
function Demo1() {
  const QUERY = "dark nav button";
  const [typed, setTyped] = useState("");
  const [showResults, setShowResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    let i = 0;
    setTyped(""); setShowResults(false);
    timerRef.current = setInterval(() => {
      i++;
      setTyped(QUERY.slice(0, i));
      if (i >= QUERY.length) {
        clearInterval(timerRef.current!);
        setTimeout(() => setShowResults(true), 400);
        setTimeout(() => { setTyped(""); setShowResults(false); }, 3800);
      }
    }, 110);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);
  const results = ["nav_dark.png","button_ui.jpg","sidebar_v2.png","menu_dark.webp"];
  return (
    <div className="flex flex-col gap-2 h-28 rounded-xl border border-slate-700/60 bg-slate-900 p-3">
      <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-700/60">
        <Search size={10} className="text-slate-500 shrink-0" />
        <span className="text-slate-200 text-[10px] flex-1 font-mono">
          {typed}<span className={`inline-block w-px h-3 bg-violet-400 ml-px ${typed.length < QUERY.length ? "animate-pulse" : "opacity-0"}`} />
        </span>
      </div>
      <div className="flex-1 grid grid-cols-4 gap-1.5">
        {results.map((name, i) => (
          <div
            key={name}
            className="bg-slate-800 rounded border border-slate-700/50 flex flex-col items-center justify-center gap-0.5 p-1 transition-all duration-300"
            style={{ transitionDelay: `${i * 100}ms`, opacity: showResults ? 1 : 0, transform: showResults ? "translateY(0)" : "translateY(6px)" }}
          >
            <FileImage size={10} className="text-violet-400" />
            <span className="text-slate-500 truncate w-full text-center" style={{fontSize:7}}>{name.split(".")[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 2: An image is "dropped" and similarity results appear with score bars. */
function Demo2() {
  const [phase, setPhase] = useState(0); // 0=idle 1=dropped 2=results
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 700);
    const t2 = setTimeout(() => setPhase(2), 1500);
    const t3 = setTimeout(() => setPhase(0), 4500);
    const t4 = setTimeout(() => setPhase(1), 5200);
    const t5 = setTimeout(() => setPhase(2), 6000);
    return () => [t1,t2,t3,t4,t5].forEach(clearTimeout);
  }, []);
  const results = [
    { name: "similar_1.jpg", score: 94 },
    { name: "variant.png",   score: 78 },
    { name: "related.webp",  score: 61 },
  ];
  return (
    <div className="flex gap-2 h-28 rounded-xl border border-slate-700/60 bg-slate-900 p-2">
      {/* Drop zone */}
      <div className={`w-24 shrink-0 rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-all duration-500 ${phase === 0 ? "border-slate-600/50 bg-slate-800/30" : "border-violet-500/60 bg-violet-500/10"}`}>
        {phase === 0 ? (
          <>
            <ScanSearch size={16} className="text-slate-600" />
            <span className="text-[8px] text-slate-600 mt-1 text-center">Drop image</span>
          </>
        ) : (
          <div className={`transition-all duration-300 ${phase >= 1 ? "opacity-100 scale-100" : "opacity-0 scale-75"}`}>
            <FileImage size={20} className="text-violet-400 mx-auto" />
            <span className="text-[7px] text-violet-300 mt-1 block text-center">query.jpg</span>
          </div>
        )}
      </div>
      {/* Results */}
      <div className="flex-1 flex flex-col gap-1.5 justify-center">
        {results.map((r, i) => (
          <div
            key={r.name}
            className="flex items-center gap-1.5 transition-all duration-300"
            style={{ transitionDelay: `${i * 120}ms`, opacity: phase >= 2 ? 1 : 0, transform: phase >= 2 ? "translateX(0)" : "translateX(8px)" }}
          >
            <FileImage size={9} className="text-slate-500 shrink-0" />
            <span className="text-[8px] text-slate-400 w-16 truncate">{r.name}</span>
            <div className="flex-1 bg-slate-700 rounded-full h-1 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-700"
                style={{ width: phase >= 2 ? `${r.score}%` : "0%", transitionDelay: `${i * 120 + 300}ms` }}
              />
            </div>
            <span className="text-[8px] text-slate-500 w-6 text-right">{r.score}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 3: Tags appear one by one on an asset card, then a "Duplicate" badge flashes. */
function Demo3() {
  const TAGS = ["button", "dark", "UI", "rounded", "blue"];
  const [visibleTags, setVisibleTags] = useState(0);
  const [showDupe, setShowDupe]       = useState(false);
  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleTags(i);
      if (i >= TAGS.length) {
        clearInterval(interval);
        setTimeout(() => setShowDupe(true), 500);
        setTimeout(() => { setVisibleTags(0); setShowDupe(false); }, 4000);
      }
    }, 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex gap-2 h-28 rounded-xl border border-slate-700/60 bg-slate-900 p-2">
      {/* Asset card */}
      <div className="w-28 shrink-0 bg-slate-800 rounded-lg border border-slate-700/50 flex flex-col overflow-hidden relative">
        <div className="flex-1 flex items-center justify-center bg-slate-700/30">
          <FileImage size={22} className="text-slate-600" />
        </div>
        <div className="px-2 py-1">
          <p className="text-[8px] text-slate-300 font-medium truncate">button_dark.png</p>
          <div className="flex flex-wrap gap-0.5 mt-1">
            {TAGS.slice(0, visibleTags).map((tag, i) => (
              <span
                key={tag}
                className="px-1 py-px rounded text-[7px] bg-violet-500/20 text-violet-300 border border-violet-500/30 transition-all duration-200"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        {showDupe && (
          <div className="absolute top-1 right-1 px-1.5 py-px rounded-full bg-red-500/20 border border-red-500/40 text-[7px] text-red-300 animate-pulse">
            Dupe
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="flex-1 flex flex-col justify-center gap-2">
        <div className="flex items-center gap-1.5">
          <Wand2 size={11} className="text-violet-400" />
          <span className="text-[9px] text-slate-400">Auto-tag with CLIP AI</span>
        </div>
        <div className="flex flex-wrap gap-0.5">
          {TAGS.map((tag, i) => (
            <span
              key={tag}
              className="px-1 py-px rounded text-[7px] border transition-all duration-300"
              style={{ opacity: visibleTags > i ? 1 : 0.25 }}
            >
              <Tag size={6} className="inline mr-0.5" />
              {tag}
            </span>
          ))}
        </div>
        <div className={`flex items-center gap-1.5 transition-all duration-300 ${showDupe ? "opacity-100" : "opacity-25"}`}>
          <File size={11} className="text-red-400" />
          <span className="text-[9px] text-slate-400">Duplicate detection</span>
        </div>
      </div>
    </div>
  );
}

const STEP_DEMOS = [Demo0, Demo1, Demo2, Demo3];

export interface WelcomeGuideProps {
  onDismiss: () => void;
  /** If provided, opens directly to this step (0-indexed). null = overview. */
  initialStep?: number | null;
}

export function WelcomeGuide({ onDismiss, initialStep = null }: WelcomeGuideProps) {
  const { addFolder } = useAssetStore();
  const t = useT();
  const { lang, setLang } = useLang();

  // null = overview, 0–3 = detail view for that step
  const [activeStep, setActiveStep] = useState<number | null>(initialStep ?? null);

  const steps = [
    { title: t.welcome.step1Title, desc: t.welcome.step1Desc, detail: t.welcome.step1Detail },
    { title: t.welcome.step2Title, desc: t.welcome.step2Desc, detail: t.welcome.step2Detail },
    { title: t.welcome.step3Title, desc: t.welcome.step3Desc, detail: t.welcome.step3Detail },
    { title: t.welcome.step4Title, desc: t.welcome.step4Desc, detail: t.welcome.step4Detail },
  ];

  const handleGetStarted = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") await addFolder(selected);
    onDismiss();
  };

  const goPrev = () => setActiveStep((s) => (s !== null && s > 0 ? s - 1 : s));
  const goNext = () => setActiveStep((s) => (s !== null && s < steps.length - 1 ? s + 1 : s));

  const StepIcon = activeStep !== null ? STEP_ICONS[activeStep] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl mx-4 overflow-hidden">

        {/* ── Top bar: lang toggle + close ───────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-0">
          <div className="flex items-center gap-1 text-xs">
            {(["en", "vi"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={
                  "px-2 py-0.5 rounded-md transition-colors " +
                  (lang === l ? "bg-violet-600 text-white font-semibold" : "text-slate-400 hover:text-slate-200")
                }
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={onDismiss} className="text-slate-500 hover:text-slate-300 transition-colors" title={t.general.close}>
            <X size={16} />
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            OVERVIEW MODE
        ══════════════════════════════════════════════════════════════ */}
        {activeStep === null && (
          <div className="p-8 pt-4 flex flex-col gap-6">
            {/* Header */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600/20 border border-violet-500/30 mb-4">
                <span className="text-2xl font-bold text-violet-400">AV</span>
              </div>
              <h1 className="text-xl font-bold text-slate-100">{t.welcome.title}</h1>
              <p className="text-sm text-slate-400 mt-1">{t.welcome.subtitle}</p>
            </div>

            {/* Step cards — clickable to open detail */}
            <div className="grid grid-cols-2 gap-3">
              {steps.map(({ title, desc }, i) => {
                const Icon = STEP_ICONS[i];
                return (
                  <button
                    key={i}
                    onClick={() => setActiveStep(i)}
                    className="flex flex-col gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 text-left hover:border-violet-500/50 hover:bg-slate-800 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold shrink-0 group-hover:bg-violet-500/40 transition-colors">
                        {i + 1}
                      </span>
                      <Icon size={14} className="text-violet-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-200">{title}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed pl-8">{desc}</p>
                    <p className="text-[10px] text-violet-500 pl-8 mt-auto group-hover:text-violet-400 transition-colors">
                      {t.welcome.learnMore} →
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleGetStarted}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
              >
                <FolderPlus size={15} />
                {t.welcome.getStarted}
              </button>
              <button onClick={onDismiss} className="text-xs text-slate-500 hover:text-slate-300 transition-colors py-1">
                {t.welcome.skip}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════
            STEP DETAIL MODE
        ══════════════════════════════════════════════════════════════ */}
        {activeStep !== null && StepIcon !== null && (
          <div className="p-8 pt-4 flex flex-col gap-5 min-h-[360px]">
            {/* Step indicator dots */}
            <div className="flex items-center justify-center gap-2 pt-1">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveStep(i)}
                  className={
                    "w-2 h-2 rounded-full transition-all " +
                    (i === activeStep ? "bg-violet-500 w-5" : "bg-slate-600 hover:bg-slate-500")
                  }
                  title={steps[i].title}
                />
              ))}
            </div>

            {/* Step content */}
            <div className="flex-1 flex flex-col items-center text-center gap-4 py-2">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/30">
                <StepIcon size={28} className="text-violet-400" />
              </div>

              {/* Animated demo */}
              <div className="w-full max-w-sm">
                {(() => { const Demo = STEP_DEMOS[activeStep]; return <Demo key={activeStep} />; })()}
              </div>

              <div>
                <p className="text-[11px] text-violet-400 font-semibold uppercase tracking-widest mb-1">
                  {t.welcome.stepLabel} {activeStep + 1} / {steps.length}
                </p>
                <h2 className="text-lg font-bold text-slate-100">{steps[activeStep].title}</h2>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed max-w-sm">
                {steps[activeStep].desc}
              </p>
              <p className="text-xs text-slate-500 leading-relaxed max-w-sm whitespace-pre-line">
                {steps[activeStep].detail}
              </p>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setActiveStep(null)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <BookOpen size={12} />
                {t.welcome.backToOverview}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={activeStep === 0}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={goNext}
                  disabled={activeStep === steps.length - 1}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              {activeStep === steps.length - 1 ? (
                <button
                  onClick={handleGetStarted}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
                >
                  <FolderPlus size={12} />
                  {t.welcome.getStarted}
                </button>
              ) : (
                <button
                  onClick={goNext}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 text-xs font-semibold transition-colors border border-violet-500/30"
                >
                  {t.welcome.next}
                  <ChevronRight size={12} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
