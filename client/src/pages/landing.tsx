import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, ArrowRight, Check, X, Star, Mic, Monitor, Shield, Brain,
  ChevronDown, ChevronUp, Download, Sparkles, Play, Upload, Target,
  MessageSquare, Clock, FileText, CreditCard, Eye, Layers,
} from "lucide-react";

// ─── Shared styles ─────────────────────────────────────────────────────────
const CARD = "bg-white border border-gray-200 rounded-2xl shadow-sm";
const CARD_HOVER = "hover:border-violet-300 hover:shadow-md transition-all duration-300";
const SECTION = "py-24 px-4 sm:px-6 lg:px-8";
const MAX = "max-w-7xl mx-auto";

// ─── Typing animation ───────────────────────────────────────────────────────
function TypingText({ text, speed = 35 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return (
    <span>
      {displayed}
      {!done && <span className="inline-block w-0.5 h-4 bg-violet-500 ml-0.5 animate-pulse align-middle" />}
    </span>
  );
}

// ─── Glow blob ──────────────────────────────────────────────────────────────
function Glow({ className }: { className: string }) {
  return <div className={`absolute rounded-full blur-3xl pointer-events-none ${className}`} />;
}

// ─── Navbar ─────────────────────────────────────────────────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/90 backdrop-blur-xl border-b border-gray-200 shadow-sm" : "bg-transparent"}`}>
      <div className={`${MAX} flex items-center justify-between gap-4 h-16 px-4 sm:px-6 lg:px-8`}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-md shadow-violet-200">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-gray-900 font-bold text-lg tracking-tight" data-testid="text-logo">Zoom Mate</span>
        </div>

        <div className="hidden md:flex items-center gap-7">
          {["how-it-works", "features", "comparison", "pricing", "faq"].map((id) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors capitalize font-medium"
            >
              {id.replace("-", " ")}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link href="/login">
            <button className="text-sm text-gray-500 hover:text-gray-900 transition-colors font-medium" data-testid="button-signin">
              Sign in
            </button>
          </Link>
          <Link href="/signup">
            <button
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-800 transition-all duration-200 shadow-sm"
              data-testid="button-signup"
            >
              Get Started
            </button>
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero mockup ────────────────────────────────────────────────────────────
const AI_RESPONSES = [
  "I've led cross-functional teams across 3 time zones, delivering a platform that reduced our client onboarding time by 40%...",
  "The core bottleneck was the database layer. I profiled the queries, added composite indexes, and moved hot data to Redis — brought p99 latency from 800ms to 60ms...",
  "My approach is always to align on the desired outcome first. I scheduled a sync with both stakeholders and built a shared priority matrix...",
];

function HeroMockup() {
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % AI_RESPONSES.length);
      setKey((k) => k + 1);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden w-full max-w-lg shadow-xl shadow-gray-200/80">
      {/* Window bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span className="w-3 h-3 rounded-full bg-yellow-400" />
          <span className="w-3 h-3 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 text-center text-xs text-gray-400 font-mono">zoom-mate · live</div>
        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
      </div>

      {/* Transcript */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
            <Mic className="w-3.5 h-3.5 text-gray-400" />
          </div>
          <div>
            <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Interviewer</p>
            <p className="text-sm text-gray-700 leading-relaxed">
              "Can you walk me through a situation where you had to handle a difficult technical challenge under pressure?"
            </p>
          </div>
        </div>
      </div>

      <div className="mx-4 my-2 border-t border-gray-100" />

      {/* AI response */}
      <div className="px-4 pb-5">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-violet-200">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-[11px] text-violet-600 font-semibold uppercase tracking-wider mb-1.5">Zoom Mate</p>
            <p className="text-sm text-gray-800 leading-relaxed">
              <TypingText key={key} text={AI_RESPONSES[idx]} speed={28} />
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-4 ml-10">
          {["Concise", "STAR", "Detailed"].map((f, i) => (
            <span
              key={f}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border ${i === 0 ? "bg-violet-50 text-violet-600 border-violet-200" : "bg-gray-50 text-gray-400 border-gray-200"}`}
            >
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-white">
      <Glow className="w-[700px] h-[500px] bg-violet-100 -top-20 left-1/2 -translate-x-1/2 opacity-70" />
      <Glow className="w-[300px] h-[300px] bg-violet-50 bottom-10 right-0" />

      <div className={`${MAX} ${SECTION} relative z-10 flex flex-col lg:flex-row items-center gap-16 w-full`}>
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 text-center lg:text-left"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold mb-8 uppercase tracking-widest">
            <Sparkles className="w-3 h-3" />
            AI Meeting Copilot
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-[-0.03em] leading-[1.04] text-gray-900" data-testid="text-hero-title">
            Your AI edge
            <br />
            in every{" "}
            <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-violet-400 bg-clip-text text-transparent">
              conversation
            </span>
          </h1>

          <p className="mt-6 text-lg text-gray-500 max-w-lg leading-relaxed mx-auto lg:mx-0" data-testid="text-hero-description">
            Zoom Mate listens to your meetings in real time, reads your screen, and surfaces the perfect response — instantly and invisibly.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
            <Link href="/signup">
              <button
                className="group flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800 transition-all duration-200 shadow-lg shadow-gray-900/15"
                data-testid="button-hero-cta"
              >
                Start for Free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </Link>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-3.5 h-3.5" />
              5 free minutes every hour · no card required
            </div>
          </div>

          <div className="mt-12 flex items-center gap-8 justify-center lg:justify-start">
            {[["10K+", "Active users"], ["<2s", "Avg response"], ["100%", "Invisible"]].map(([val, label]) => (
              <div key={label}>
                <p className="text-2xl font-black text-gray-900">{val}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 flex justify-center lg:justify-end w-full"
        >
          <HeroMockup />
        </motion.div>
      </div>
    </section>
  );
}

// ─── Marquee ─────────────────────────────────────────────────────────────────
function Marquee() {
  const items = [
    "Real-time transcription", "Screen analysis", "Invisible overlay",
    "Custom knowledge", "STAR format", "Instant responses",
    "Sales calls", "Client demos", "Team standups", "Strategy sessions",
  ];
  const doubled = [...items, ...items];
  return (
    <div className="bg-gray-50 border-y border-gray-200 py-4 overflow-hidden">
      <motion.div
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, ease: "linear", repeat: Infinity }}
        className="flex gap-10 whitespace-nowrap"
      >
        {doubled.map((item, i) => (
          <span key={i} className="flex items-center gap-3 text-sm text-gray-400 font-medium shrink-0">
            <span className="w-1 h-1 rounded-full bg-violet-400" />
            {item}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

// ─── Features bento ──────────────────────────────────────────────────────────
function FeaturesSection() {
  return (
    <section id="features" className={`${SECTION} bg-white`}>
      <div className={MAX}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Features</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900" data-testid="text-features-title">
            Built for the moments
            <br />
            <span className="text-gray-400">that actually matter</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 auto-rows-[200px]">

          {/* Large — Screen awareness */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className={`md:col-span-4 md:row-span-2 ${CARD} ${CARD_HOVER} p-8 flex flex-col justify-between relative overflow-hidden`}
          >
            <Glow className="w-64 h-64 bg-violet-100 -bottom-20 -right-20 opacity-60" />
            <div>
              <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-5">
                <Monitor className="w-6 h-6 text-violet-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Full Screen Awareness</h3>
              <p className="text-gray-500 leading-relaxed max-w-sm">
                Zoom Mate sees exactly what's on your screen — shared slides, code, documents — and factors it all into every response. Context-perfect, every time.
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              {["Slide deck", "Code review", "Data report"].map((t) => (
                <span key={t} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 border border-gray-200 font-medium">{t}</span>
              ))}
            </div>
          </motion.div>

          {/* Small — Invisible */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className={`md:col-span-2 ${CARD} ${CARD_HOVER} p-6 flex flex-col justify-between`}
          >
            <div className="w-11 h-11 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center">
              <Eye className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-1.5">Completely Invisible</h3>
              <p className="text-sm text-gray-500">Hidden during screen sharing. Nobody knows it's there.</p>
            </div>
          </motion.div>

          {/* Small — Real-time */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className={`md:col-span-2 ${CARD} ${CARD_HOVER} p-6 flex flex-col justify-between`}
          >
            <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <Mic className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-1.5">Real-time Listening</h3>
              <p className="text-sm text-gray-500">Captures both sides of every conversation as it happens.</p>
            </div>
          </motion.div>

          {/* Large — Custom knowledge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className={`md:col-span-3 ${CARD} ${CARD_HOVER} p-8 flex flex-col justify-between relative overflow-hidden`}
          >
            <Glow className="w-48 h-48 bg-fuchsia-100 -top-10 -right-10 opacity-50" />
            <div>
              <div className="w-12 h-12 rounded-2xl bg-fuchsia-50 border border-fuchsia-100 flex items-center justify-center mb-5">
                <Brain className="w-6 h-6 text-fuchsia-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Trained on Your Story</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                Upload your background materials and notes. Zoom Mate speaks in your voice with your specific details — never generic answers.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <FileText className="w-4 h-4 text-gray-300" />
              <span className="text-xs text-gray-400">Supports PDFs, DOCX, plain text &amp; more</span>
            </div>
          </motion.div>

          {/* Large — Flexible formats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className={`md:col-span-3 ${CARD} ${CARD_HOVER} p-8 flex flex-col justify-between relative overflow-hidden`}
          >
            <Glow className="w-48 h-48 bg-orange-100 -bottom-10 -left-10 opacity-50" />
            <div>
              <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center mb-5">
                <Layers className="w-6 h-6 text-orange-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Flexible Response Styles</h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                Concise for quick facts. STAR for structured stories. Detailed for deep dives. Switch formats mid-session without breaking flow.
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              {["Concise", "STAR", "Detailed", "Bullet"].map((f) => (
                <span key={f} className="text-xs px-2.5 py-1 rounded-lg bg-orange-50 text-orange-500 border border-orange-100 font-medium">{f}</span>
              ))}
            </div>
          </motion.div>

          {/* Wide — Pay per use */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25 }}
            className={`md:col-span-6 ${CARD} ${CARD_HOVER} p-7 flex flex-col sm:flex-row items-center justify-between gap-6`}
          >
            <div className="flex items-center gap-5">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
                <CreditCard className="w-6 h-6 text-violet-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Pay Only for What You Use</h3>
                <p className="text-gray-500 text-sm mt-1">No wasted credits. No monthly minimums. Minutes never expire. Zoom Mate only bills when it's actively helping you.</p>
              </div>
            </div>
            <Link href="/signup">
              <button className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold transition-all">
                View Pricing <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    { n: "01", icon: Target, title: "Choose your setup", desc: "Pick the type of copilot — sales call, client demo, team standup, or custom. Zoom Mate adapts its behaviour to your scenario.", color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-100" },
    { n: "02", icon: Upload, title: "Add your context", desc: "Upload documents, talking points, or background materials. The more context you give, the more personalised every answer becomes.", color: "text-cyan-600", bg: "bg-cyan-50", border: "border-cyan-100" },
    { n: "03", icon: Zap, title: "Perform with confidence", desc: "Launch your session. Zoom Mate runs silently, listens to everything, reads your screen, and surfaces the right answer exactly when you need it.", color: "text-fuchsia-600", bg: "bg-fuchsia-50", border: "border-fuchsia-100" },
  ];

  return (
    <section id="how-it-works" className={`${SECTION} bg-gray-50`}>
      <div className={MAX}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">How it works</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900" data-testid="text-how-title">
            Three steps to never
            <br />
            <span className="text-gray-400">lose the room again</span>
          </h2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          <div className="hidden md:block absolute top-12 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent" />
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className={`${CARD} p-8 flex flex-col`}
            >
              <div className="flex items-center justify-between mb-8">
                <div className={`w-12 h-12 rounded-2xl ${step.bg} border ${step.border} flex items-center justify-center`}>
                  <step.icon className={`w-5 h-5 ${step.color}`} />
                </div>
                <span className="text-5xl font-black text-gray-100">{step.n}</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">{step.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Code auto-type demo ─────────────────────────────────────────────────────
const CODE_TARGET = `def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []`;

// Sequence: [char, delay_ms] — negative char = backspace that many times
type Step = [string, number];

function buildHumanSteps(target: string): Step[] {
  const steps: Step[] = [];
  let i = 0;
  while (i < target.length) {
    const ch = target[i];
    // Occasionally insert a typo then backspace
    if (Math.random() < 0.06 && ch !== "\n" && ch !== " ") {
      const typos = "qwryuopsdfghjklzxcvbnm";
      const wrong = typos[Math.floor(Math.random() * typos.length)];
      steps.push([wrong, 60 + Math.random() * 60]);
      steps.push(["\b", 80 + Math.random() * 80]);
    }
    // Vary speed: fast on common chars, slower on special
    const base = ch === "\n" ? 120 : ch === " " ? 40 : 55;
    steps.push([ch, base + Math.random() * base * 0.8]);
    i++;
  }
  return steps;
}

function CodeAutoTypeDemo() {
  const [displayed, setDisplayed] = useState("");
  const [phase, setPhase] = useState<"typing" | "done" | "pausing">("typing");
  const stepsRef = useRef<Step[]>([]);
  const idxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runNext = () => {
    if (idxRef.current >= stepsRef.current.length) {
      setPhase("pausing");
      timerRef.current = setTimeout(() => {
        setDisplayed("");
        idxRef.current = 0;
        stepsRef.current = buildHumanSteps(CODE_TARGET);
        setPhase("typing");
        scheduleNext();
      }, 3000);
      return;
    }
    const [ch, delay] = stepsRef.current[idxRef.current++];
    timerRef.current = setTimeout(() => {
      setDisplayed((prev) => ch === "\b" ? prev.slice(0, -1) : prev + ch);
      runNext();
    }, delay);
  };

  const scheduleNext = () => {
    timerRef.current = setTimeout(runNext, 50);
  };

  useEffect(() => {
    stepsRef.current = buildHumanSteps(CODE_TARGET);
    scheduleNext();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Syntax highlight helpers
  const keywords = /\b(def|return|for|in|if)\b/g;
  const strings = /(["'])(?:(?=(\\?))\2.)*?\1/g;
  const comments = /#.*/g;
  const numbers = /\b\d+\b/g;

  const highlight = (code: string) => {
    return code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(comments, (m) => `<span style="color:#6a9955">${m}</span>`)
      .replace(strings, (m) => `<span style="color:#ce9178">${m}</span>`)
      .replace(keywords, (m) => `<span style="color:#c586c0">${m}</span>`)
      .replace(numbers, (m) => `<span style="color:#b5cea8">${m}</span>`);
  };

  const lines = displayed.split("\n");

  return (
    <section className={`${SECTION} bg-white`}>
      <div className={MAX}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Desktop App</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900">
            Types code for you.
            <br />
            <span className="text-gray-400">Looks completely human.</span>
          </h2>
          <p className="mt-5 text-gray-500 text-lg max-w-xl mx-auto leading-relaxed">
            The desktop app reads the question, generates the solution, then types it into any coding assessment — with natural speed variation, pauses, and corrections. Proctoring software sees a human.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className="max-w-3xl mx-auto"
        >
          {/* Outer card — looks like a browser/app window */}
          <div className="rounded-2xl border border-gray-200 shadow-xl shadow-gray-200/60 overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-100 border-b border-gray-200">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-yellow-400" />
                <span className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <span className="flex-1 text-center text-xs text-gray-400 font-mono">Assessment · Python · Two Sum</span>
              {/* Zoom Mate status pill */}
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                ZM typing
              </span>
            </div>

            {/* Editor area */}
            <div className="bg-[#1e1e1e] p-5 min-h-[280px] font-mono text-sm leading-6">
              {/* Line numbers + code */}
              <div className="flex gap-4">
                <div className="select-none text-right" style={{ color: "#858585", minWidth: 24 }}>
                  {lines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                <div className="flex-1 overflow-x-auto">
                  {lines.map((line, i) => (
                    <div key={i}>
                      <span
                        dangerouslySetInnerHTML={{ __html: highlight(line) || "&nbsp;" }}
                        style={{ color: "#d4d4d4" }}
                      />
                      {/* Blinking cursor on last line */}
                      {i === lines.length - 1 && phase !== "pausing" && (
                        <span
                          className="inline-block w-[2px] h-[1em] align-middle ml-px animate-pulse"
                          style={{ backgroundColor: "#aeafad" }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#007acc] text-white text-[10px] font-medium">
              <span>Python 3.11</span>
              <span className="flex items-center gap-2">
                <span className="opacity-70">Ln {lines.length}, Col {(lines[lines.length - 1]?.length ?? 0) + 1}</span>
                {phase === "typing" && (
                  <span className="flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full">
                    <Zap className="w-2.5 h-2.5" /> Zoom Mate active
                  </span>
                )}
                {phase === "pausing" && (
                  <span className="bg-white/20 px-2 py-0.5 rounded-full">Solution complete ✓</span>
                )}
              </span>
            </div>
          </div>

          {/* Caption pills */}
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            {[
              "Variable typing speed",
              "Natural typos & corrections",
              "Bypasses keystroke analysis",
              "Works on HackerRank, LeetCode & more",
            ].map((label) => (
              <span key={label} className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 font-medium">
                {label}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function StatsSection() {
  const stats = [
    { val: "10,000+", label: "Sessions completed" },
    { val: "<2s", label: "Average response time" },
    { val: "6+", label: "Response formats" },
    { val: "100%", label: "Invisible to others" },
  ];
  return (
    <div className="bg-white border-y border-gray-200">
      <div className={`${MAX} px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-2 md:grid-cols-4 gap-8`}>
        {stats.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="text-center"
          >
            <p className="text-3xl sm:text-4xl font-black text-gray-900 mb-1">{s.val}</p>
            <p className="text-sm text-gray-400">{s.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Comparison ───────────────────────────────────────────────────────────────
function ComparisonSection() {
  const rows = [
    { feature: "Real-time AI responses",          web: true,  desktop: true  },
    { feature: "Live conversation transcript",    web: true,  desktop: true  },
    { feature: "Custom knowledge upload",         web: true,  desktop: true  },
    { feature: "Multiple response formats",       web: true,  desktop: true  },
    { feature: "Screen analyzer",                 web: true,  desktop: true  },
    { feature: "Works on mobile",                 web: true,  desktop: false },
    { feature: "No install required",             web: true,  desktop: false },
    { feature: "Auto-types answers into any app", web: false, desktop: true  },
    { feature: "Captures system audio",           web: false, desktop: true  },
    { feature: "Invisible overlay (OS level)",    web: false, desktop: true  },
    { feature: "Live code editor & auto-type",    web: false, desktop: true  },
    { feature: "Keyboard shortcuts",              web: false, desktop: true  },
  ];

  return (
    <section id="comparison" className={`${SECTION} bg-gray-50`}>
      <div className={MAX}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Web vs Desktop</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900" data-testid="text-comparison-title">
            Pick the right tool
            <br />
            <span className="text-gray-400">for your situation</span>
          </h2>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <div className={`${CARD} overflow-x-auto`}>
            <table className="w-full text-sm" data-testid="table-comparison">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left p-5 text-gray-400 font-medium w-1/2">Feature</th>
                  <th className="p-5 font-bold text-center text-violet-600">
                    <span className="inline-flex flex-col items-center gap-1">
                      <Monitor className="w-4 h-4" />
                      Web App
                    </span>
                  </th>
                  <th className="p-5 font-bold text-center text-gray-700">
                    <span className="inline-flex flex-col items-center gap-1">
                      <Download className="w-4 h-4" />
                      Desktop App
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-b-0 hover:bg-gray-50/60 transition-colors">
                    <td className="p-5 text-gray-600">{row.feature}</td>
                    <td className="p-5 text-center">
                      {row.web
                        ? <Check className="w-5 h-5 mx-auto text-violet-500" />
                        : <X className="w-5 h-5 mx-auto text-gray-200" />}
                    </td>
                    <td className="p-5 text-center">
                      {row.desktop
                        ? <Check className="w-5 h-5 mx-auto text-gray-700" />
                        : <X className="w-5 h-5 mx-auto text-gray-200" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            Desktop app coming soon · <Link href="/signup" className="text-violet-600 hover:underline">Use the web app now for free</Link>
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Pricing ─────────────────────────────────────────────────────────────────
function PricingSection() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["/api/stripe/products"] });

  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "5 min/hr · forever",
      desc: "Try it out. No commitment.",
      cta: "Get Started Free",
      features: ["Real-time transcription", "Instant AI responses", "Invisible overlay", "Screen analyzer", "Custom knowledge", "Multiple formats"],
      popular: false,
      stripePlan: "free",
    },
    {
      name: "Standard",
      price: "$14.99",
      period: "per month",
      desc: "For professionals who need an edge.",
      cta: "Subscribe Now",
      features: ["Everything in Free", "Priority response speed", "Minutes never expire", "Priority support", "Unlimited sessions", "Advanced formats"],
      popular: true,
      stripePlan: "standard",
    },
    {
      name: "Enterprise",
      price: "$49.99",
      period: "per month",
      desc: "For teams at scale.",
      cta: "Subscribe Now",
      features: ["Everything in Standard", "Custom integrations", "Enterprise security", "Team management", "Dedicated manager", "SLA guarantee"],
      popular: false,
      stripePlan: "enterprise",
    },
  ];

  const handleSubscribe = async (stripePlan: string) => {
    if (stripePlan === "free") { window.location.href = "/signup"; return; }
    const product = products.find((p: any) => p.metadata?.plan === stripePlan);
    if (!product?.prices?.length) { window.location.href = "/signup"; return; }
    setLoadingPlan(stripePlan);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ priceId: product.prices[0].id }) });
      if (res.status === 401) { window.location.href = "/signup"; return; }
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { window.location.href = "/signup"; }
    finally { setLoadingPlan(null); }
  };

  return (
    <section id="pricing" className={`${SECTION} bg-white`}>
      <div className={MAX}>
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Pricing</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900" data-testid="text-pricing-title">
            Simple pricing.
            <br /><span className="text-gray-400">No surprises.</span>
          </h2>
          <p className="mt-4 text-gray-400 text-lg">Minutes never expire. Pay only when Zoom Mate is actively helping you.</p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative"
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                  <span className="px-4 py-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-xs font-bold text-white shadow-md shadow-violet-200 whitespace-nowrap">
                    Most Popular
                  </span>
                </div>
              )}
              <div
                className={`bg-white rounded-2xl p-7 h-full flex flex-col border transition-all ${plan.popular ? "border-violet-300 shadow-lg shadow-violet-100" : "border-gray-200 hover:border-violet-200 shadow-sm"}`}
                data-testid={`card-pricing-${plan.name.toLowerCase()}`}
              >
                <div className="mb-7">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">{plan.name}</h3>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-gray-900">{plan.price}</span>
                    <span className="text-gray-400 text-sm">{plan.period}</span>
                  </div>
                  <p className="text-sm text-gray-400 mt-2">{plan.desc}</p>
                </div>
                <button
                  onClick={() => handleSubscribe(plan.stripePlan)}
                  disabled={loadingPlan === plan.stripePlan}
                  className={`w-full py-3 rounded-2xl text-sm font-bold transition-all duration-200 mb-7 ${plan.popular ? "bg-gray-900 hover:bg-gray-800 text-white shadow-sm" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}
                  data-testid={`button-pricing-${plan.name.toLowerCase()}`}
                >
                  {loadingPlan === plan.stripePlan ? "Loading..." : plan.cta}
                </button>
                <ul className="space-y-3 flex-1">
                  {plan.features.map((f, fi) => (
                    <li key={fi} className="flex items-center gap-2.5 text-sm">
                      <Check className="w-4 h-4 text-violet-500 shrink-0" />
                      <span className="text-gray-500">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Testimonials ─────────────────────────────────────────────────────────────
function TestimonialsSection() {
  const testimonials = [
    { quote: "A tough question came out of nowhere. Zoom Mate had a clear, structured answer on my screen in under two seconds. I nailed it. Got the offer.", name: "Sarah M.", role: "Software Engineer · Series B startup" },
    { quote: "Mid-demo the client asked for a specific metric I hadn't memorised. Zoom Mate pulled the right number instantly. We closed a $200K deal that day.", name: "James K.", role: "Sales Director · Enterprise SaaS" },
    { quote: "I upload my weekly notes before every standup. Zoom Mate turns them into crisp talking points on the fly. It's become non-negotiable for me.", name: "Priya R.", role: "Product Manager · Fortune 500" },
  ];
  return (
    <section className={`${SECTION} bg-gray-50`}>
      <div className={MAX}>
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">Testimonials</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900" data-testid="text-testimonials-title">
            Trusted by people
            <br /><span className="text-gray-400">who perform under pressure</span>
          </h2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`${CARD} ${CARD_HOVER} p-7 flex flex-col`}
              data-testid={`card-testimonial-${i}`}
            >
              <div className="flex gap-1 mb-5">
                {[...Array(5)].map((_, si) => <Star key={si} className="w-4 h-4 text-yellow-400 fill-yellow-400" />)}
              </div>
              <p className="text-gray-600 text-sm leading-relaxed flex-1">"{t.quote}"</p>
              <div className="mt-5 pt-5 border-t border-gray-100">
                <p className="font-bold text-gray-900 text-sm">{t.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t.role}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqs = [
    { question: "How does Zoom Mate work during a meeting?", answer: "Zoom Mate runs as an invisible overlay on your desktop. It captures the audio from your conversation in real time and analyses your screen for context. When you need an answer, it appears on your screen instantly — your call participants never see it." },
    { question: "Is it detectable during screen sharing?", answer: "No. Zoom Mate uses a special overlay that is not captured by Zoom, Google Meet, Teams, or any other screen sharing software." },
    { question: "What platforms does it support?", answer: "Zoom Mate works on Windows and macOS. It is compatible with any meeting software including Zoom, Google Meet, Microsoft Teams, Webex, and even phone calls." },
    { question: "How does pricing work?", answer: "You only pay for active assist minutes. The free tier gives you 5 minutes every hour at no cost. Purchased minutes never expire and there are no subscriptions that bill you when you're not using it." },
    { question: "Can I upload my own materials?", answer: "Yes. Upload PDFs, documents, plain text, and more. Zoom Mate uses this as context for every response — so answers reference your actual background and materials, not generic information." },
  ];

  return (
    <section id="faq" className={`${SECTION} bg-white`}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600 mb-4">FAQ</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-[-0.03em] text-gray-900" data-testid="text-faq-title">Questions answered</h2>
        </motion.div>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
              <div className={`${CARD} overflow-hidden`}>
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-gray-50 transition-colors"
                  data-testid={`button-faq-${i}`}
                >
                  <span className="font-semibold text-sm text-gray-800">{faq.question}</span>
                  {openIndex === i ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                </button>
                <AnimatePresence>
                  {openIndex === i && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                      <p className="px-5 pb-5 text-sm text-gray-500 leading-relaxed border-t border-gray-100 pt-4">{faq.answer}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── CTA ─────────────────────────────────────────────────────────────────────
function CTASection() {
  return (
    <section id="download" className={`${SECTION} bg-gray-50`}>
      <div className={MAX}>
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <div className="relative rounded-3xl overflow-hidden border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-12 sm:p-20 text-center">
            <Glow className="w-[500px] h-[200px] bg-violet-200 top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-40" />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-violet-100 border border-violet-200 text-violet-700 text-xs font-bold mb-8 uppercase tracking-widest">
                🚀 Desktop App Coming Soon
              </div>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-[-0.03em] text-gray-900 mb-5" data-testid="text-download-title">
                Start performing
                <br />at your best — today
              </h2>
              <p className="text-gray-500 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
                The desktop app is on the way. Until then, Zoom Mate is fully available in your browser. No install. No setup. Just results.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/signup">
                  <button className="group flex items-center gap-2 px-8 py-4 rounded-2xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800 transition-all shadow-lg shadow-gray-900/10" data-testid="button-download-web">
                    Try in Browser — It's Free
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </Link>
                <button disabled className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-white text-gray-300 border border-gray-200 font-semibold text-sm cursor-not-allowed" data-testid="button-download-cta">
                  <Download className="w-4 h-4" />
                  Download Desktop
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function Footer() {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <footer className="bg-white border-t border-gray-200 py-16 px-4 sm:px-6 lg:px-8">
      <div className={MAX}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-sm shadow-violet-200">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-gray-900 text-lg tracking-tight" data-testid="text-footer-logo">Zoom Mate</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed max-w-[200px]">AI-powered meeting copilot. Say the right thing, every time.</p>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Product</h4>
            <ul className="space-y-3">
              {[["Features", "features"], ["Pricing", "pricing"], ["FAQ", "faq"], ["Download", "download"]].map(([label, id]) => (
                <li key={id}><button onClick={() => scrollTo(id)} className="text-sm text-gray-400 hover:text-gray-900 transition-colors" data-testid={`link-footer-${id}`}>{label}</button></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Legal</h4>
            <ul className="space-y-3">
              {[["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"], ["Refund Policy", "/refund"]].map(([label, href]) => (
                <li key={href}><Link href={href} className="text-sm text-gray-400 hover:text-gray-900 transition-colors">{label}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5">Compare</h4>
            <ul className="space-y-3">
              {["vs Final Round AI", "vs Cluely", "vs Parakeet AI"].map((item) => (
                <li key={item}><span className="text-sm text-gray-300">{item}</span></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-300" data-testid="text-copyright">© 2025 Zoom Mate. All rights reserved.</p>
          <p className="text-xs text-gray-300">Built for people who can't afford to lose the room.</p>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <HeroSection />
      <Marquee />
      <FeaturesSection />
      <CodeAutoTypeDemo />
      <StatsSection />
      <HowItWorksSection />
      <ComparisonSection />
      <PricingSection />
      <TestimonialsSection />
      <FAQSection />
      <CTASection />
      <Footer />
    </div>
  );
}
