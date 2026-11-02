import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import './style.css';

const VERSION = '0.2.0';
const DOWNLOAD = `/download/Code-Agent-${VERSION}-win-x64.exe`;
const SHA = 'fac9642510844cb0829b2efbd41a5f7a975c1b86018f2015b41054c4dd5c3ed8';
const REPO = 'https://github.com/sushilbang/code-agent';
const ease = [0.22, 1, 0.36, 1];

/* Slow-drifting colour fields with film grain. */
function GradientBg() {
  return (
    <div className="gbg" aria-hidden="true">
      <i className="blob b1" /><i className="blob b2" /><i className="blob b3" /><i className="blob b4" />
      <svg className="grain" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch" /><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0" /></filter><rect width="100%" height="100%" filter="url(#n)" /></svg>
    </div>
  );
}

/* Words light up as the paragraph scrolls through the viewport. *word* marks an accent. */
function ScrollReveal({ text }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.8', 'end 0.45'] });
  const words = text.split(' ');
  return (
    <p className="reveal" ref={ref}>
      {words.map((raw, i) => {
        const accent = raw.startsWith('*');
        return <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} accent={accent}>{raw.replaceAll('*', '')}</Word>;
      })}
    </p>
  );
}
function Word({ children, progress, range, accent }) {
  const opacity = useTransform(progress, range, [0.16, 1]);
  return <><motion.span style={{ opacity }} className={accent ? 'acc' : ''}>{children}</motion.span>{' '}</>;
}

function Rise({ children, delay = 0, className, as = 'div' }) {
  const Tag = motion[as];
  return <Tag className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.8, ease, delay }}>{children}</Tag>;
}

function Nav() {
  const { scrollY } = useScroll();
  const bg = useTransform(scrollY, [0, 80], ['rgba(10,9,8,0)', 'rgba(10,9,8,0.8)']);
  return (
    <motion.header className="nav" style={{ background: bg }}>
      <a className="logo" href="#top"><span className="mark">{'</>'}</span> Code Agent</a>
      <nav>
        <a href="#how">How it works</a><a href="#features">Features</a><a href="#safety">Safety</a><a href="#faq">FAQ</a>
        <a className="pill" href={DOWNLOAD}>Download</a>
      </nav>
    </motion.header>
  );
}

function Hero() {
  const lines = ['A coding agent', 'you can '];
  return (
    <section className="hero" id="top">
      <GradientBg />
      <div className="wrap">
        <motion.p className="kicker" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>Desktop app for Windows — v{VERSION}</motion.p>
        <h1>
          {lines.map((l, i) => <span className="line" key={i}><motion.span style={{ display: 'inline-block' }} initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 1, ease, delay: 0.15 + i * 0.12 }}>{l}{i === 1 && <em>audit.</em>}</motion.span></span>)}
        </h1>
        <motion.p className="sub" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.55 }}>
          An editor and an agent in one window. It reads your repository, proposes every change as a diff, and does nothing until you say so.
        </motion.p>
        <motion.div className="cta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.7 }}>
          <a className="btn solid" href={DOWNLOAD}>Download for Windows <span>↓</span></a>
          <a className="btn line" href={REPO}>Source on GitHub</a>
        </motion.div>
      </div>
    </section>
  );
}

function Showcase() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.95', 'start 0.35'] });
  const p = useSpring(scrollYProgress, { stiffness: 80, damping: 26 });
  const y = useTransform(p, [0, 1], [60, 0]);
  const scale = useTransform(p, [0, 1], [0.94, 1]);
  return (
    <section className="showcase wrap" ref={ref}>
      <motion.figure style={{ y, scale }}>
        <video src="media/demo.mp4" poster="media/poster.png" autoPlay muted loop playsInline preload="metadata" />
        <figcaption>Scripted walkthrough, rendered with the app's own stylesheet.</figcaption>
      </motion.figure>
    </section>
  );
}

function Manifesto() {
  return (
    <section className="manifesto wrap">
      <ScrollReveal text="Most coding agents ask you to trust them. Code Agent asks you to *read* them. Every file change arrives as a *diff*, every command waits for a *yes*, and your keys never leave the *main process*." />
    </section>
  );
}

const STEPS = [
  ['01', 'Ask', 'Describe the change in plain language. The agent searches, globs and reads the repository, with file excerpts and project memory shown on the message.'],
  ['02', 'Review', 'Edits arrive as a unified diff inside the chat — current file, proposed file and the diff itself — before anything is written.'],
  ['03', 'Decide', 'Reject, allow once, or always allow that action in that folder. Always-allow can be revoked from the settings panel.']
];

function How() {
  return (
    <section id="how" className="section wrap">
      <Rise as="h2" className="h2">How an edit happens</Rise>
      <div className="steps">
        {STEPS.map(([n, t, d], i) => (
          <Rise key={n} delay={i * 0.1} className="step"><span className="num">{n}</span><h3>{t}</h3><p>{d}</p></Rise>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  ['Reviewable diffs', 'Contextual unified diffs for every file mutation, kept in the chat after the action succeeds.'],
  ['Read-only sub-agents', 'Two or three investigations at once, or a small dependency graph. Isolated context, read and search tools only, one shared token budget.'],
  ['Visible context', 'A token indicator for the latest request, configurable warning and compaction thresholds, and a list of every excerpt and memory item sent.'],
  ['Project memory', 'Facts and decisions scoped to a workspace. Edit, disable or delete them; credential-like text is rejected on save.'],
  ['Approved commands', 'Run an executable with an argument array — no implicit shell — inside the workspace, with timeouts and process-tree cancellation.'],
  ['Git inspection', 'Structured status and bounded staged or unstaged diffs, available to the agent as read-only tools.'],
  ['Monaco editor', 'Tabs, unsaved-change prompts, and saves that refuse to overwrite a file that changed on disk.'],
  ['Local history', 'Chats, permissions and memory live in local app data; each chat remembers its folder.']
];

function Features() {
  return (
    <section id="features" className="section wrap split">
      <div className="sticky"><Rise as="h2" className="h2">What is in the box</Rise><Rise delay={0.1} className="lead">Everything runs locally except the model request itself.</Rise></div>
      <ul className="rows">
        {FEATURES.map(([t, d], i) => (
          <motion.li key={t} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.7, ease }}>
            <span className="idx">{String(i + 1).padStart(2, '0')}</span><div><h3>{t}</h3><p>{d}</p></div>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

const SAFETY = [
  ['API key', 'Encrypted with the OS credential store (Electron safeStorage). The renderer only learns whether a key exists.'],
  ['Process boundary', 'Context-isolated preload with a small typed API. No generic IPC, no Node.js in the renderer.'],
  ['File writes', 'Refuse to overwrite a file that changed on disk since it was opened.'],
  ['Deletes', 'Confirmed, rechecked, and limited to 200 entries and 10 MB.'],
  ['Storage', 'Chats, permissions and project memory stay in local app data. Memory is not encrypted — do not store secrets in it.']
];

function Safety() {
  return (
    <section id="safety" className="section wrap">
      <Rise as="h2" className="h2">Where the lines are drawn</Rise>
      <dl className="spec">
        {SAFETY.map(([k, v], i) => <Rise key={k} delay={i * 0.05} className="spec-row"><dt>{k}</dt><dd>{v}</dd></Rise>)}
      </dl>
    </section>
  );
}

function Download() {
  return (
    <section id="download" className="dl">
      <GradientBg />
      <div className="wrap dl-in">
        <Rise as="h2" className="h2 big">Try it on a repo<br />you care about.</Rise>
        <Rise delay={0.1} className="dl-card">
          <a className="btn solid" href={DOWNLOAD}>Download Code-Agent-{VERSION}.exe <span>↓</span></a>
          <dl className="meta">
            <div><dt>Platform</dt><dd>Windows 10/11, x64</dd></div>
            <div><dt>Size</dt><dd>114 MB, portable, no installer</dd></div>
            <div><dt>SHA-256</dt><dd className="mono">{SHA}</dd></div>
            <div><dt>Signing</dt><dd>Unsigned — SmartScreen will warn</dd></div>
          </dl>
        </Rise>
      </div>
    </section>
  );
}

const FAQ = [
  ['Why does Windows warn me?', 'The build is not code-signed. Choose More info, then Run anyway — or verify the SHA-256 above, or build from source.'],
  ['Can the agent change files without asking?', 'Only for an action you marked Always allow, in the folder where you marked it. You can revoke it at any time.'],
  ['Which models can I use?', 'OpenAI models from a fixed allowlist, chosen in the composer. Local inspection mode needs no key.'],
  ['How do I build it myself?', 'Install Node.js 22+, clone the repo, run npm install then npm start.']
];

function Faq() {
  return (
    <section id="faq" className="section wrap split">
      <Rise as="h2" className="h2">Questions</Rise>
      <div className="faq">
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </div>
    </section>
  );
}

function App() {
  return (
    <>
      <Nav />
      <main><Hero /><Showcase /><Manifesto /><How /><Features /><Safety /><Download /><Faq /></main>
      <footer className="foot wrap"><span>Code Agent {VERSION}</span><span><a href={REPO}>GitHub</a> · <a href="https://sushilbang.com">sushilbang.com</a></span></footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
