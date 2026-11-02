import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import './style.css';

const VERSION = '0.2.0';
const DOWNLOAD = `/download/Code-Agent-${VERSION}-win-x64.exe`;
const SHA = 'fac9642510844cb0829b2efbd41a5f7a975c1b86018f2015b41054c4dd5c3ed8';
const REPO = 'https://github.com/sushilbang/code-agent';
const ease = [0.22, 1, 0.36, 1];

/* Plays only while on screen, so offscreen videos cost nothing. */
function Video(props) {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: '120px' });
  React.useEffect(() => { const v = ref.current; if (!v) return; if (inView) v.play().catch(() => {}); else v.pause(); }, [inView]);
  return <video ref={ref} muted loop playsInline preload="metadata" {...props} />;
}

/* Slow-drifting colour fields with film grain. */
function GradientBg() {
  return (
    <div className="gbg" aria-hidden="true">
      <i className="blob b1" /><i className="blob b2" /><i className="blob b3" /><i className="blob b4" />
      <i className="grain" />
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
  const bg = useTransform(scrollY, [0, 80], ['rgba(10,9,8,0)', 'rgba(10,9,8,0.92)']);
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
  return (
    <section className="showcase wrap">
      <figure className="vframe">
        <Video src="media/demo.mp4" poster="media/poster.png" />
      </figure>
      <p className="vcap">Scripted walkthrough, rendered with the app's own stylesheet.</p>
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
  { title: 'Every edit is a diff you approve', media: 'diff', video: 'clip-diff.mp4', alt: 'An edit_file approval card showing a unified diff with Reject, Allow once and Always allow',
    text: 'Before any file is written, the chat shows the current file, the proposed file and a contextual unified diff. You choose Reject, Allow once, or Always allow for that action in that folder.',
    points: ['The diff stays in the conversation after the change lands', 'Always-allow is per action, per folder, and revocable', 'Unsaved editor changes are protected from agent writes'] },
  { title: 'Read-only sub-agents', media: 'subagents', video: 'clip-subagents.mp4', alt: 'A delegate tool step listing three completed investigations and a token budget',
    text: 'For two or three independent questions, the agent can fan out bounded investigations at once. Each child has its own context and can only read, search and inspect Git — it cannot edit, run commands, or delegate further.',
    points: ['Small dependency graphs: ready tasks run together, dependent ones wait', 'One shared token budget per run, shown as it is used', 'Concise reports come back to the parent for synthesis'] },
  { title: 'Context you can see', media: 'context', alt: 'The Context usage dialog with working budget, warning and compaction thresholds',
    text: 'A live indicator above the composer shows input tokens for the latest request. Set a working budget and the thresholds at which it warns and the provider compacts the run.',
    points: ['API-reported counts replace local estimates when they arrive', 'Every file excerpt and memory item sent is listed on the message', 'The budget is a planning preference, not the model limit'] },
  { title: 'Project memory you control', media: 'memory', alt: 'The Project memory panel with saved facts, each with a Use toggle, Edit and Delete',
    text: 'Save facts and decisions for a workspace and relevant ones are included in new runs. They live beside, not inside, your chats — so you can correct or remove them without touching history.',
    points: ['Add, edit, disable or delete any item', 'Credential-looking text is rejected on save', 'Stored locally and unencrypted — keep secrets out'] },
  { title: 'Commands, without a shell', media: 'commands', alt: 'A run command approval showing the executable and its argument array',
    text: 'Approved commands run an executable directly with a separate argument array — there is no implicit shell to interpret surprises. Package diagnostics only pick an existing test, lint, check or build script.',
    points: ['Approval required every time', 'Workspace-contained working directory, bounded streamed output', 'Timeouts and process-tree termination on cancel'] },
  { title: 'Git, read-only', media: 'git', alt: 'git_status and git_diff tool steps listing staged and unstaged changes',
    text: 'The agent can see what you have changed without being able to change it. Status is structured, and staged or unstaged diffs are bounded by file, result and size limits.',
    points: ['Ask “what have I changed?” and get an answer from the real tree', 'Nothing is staged, committed or reset by these tools'] },
  { title: 'A real editor, careful with your files', media: 'editor', alt: 'The Monaco editor with three tabs and a refused save after an on-disk change',
    text: 'Monaco handles the editing: tabs, syntax highlighting, and unsaved-change markers. If a file changed on disk since you opened it, saving is refused instead of overwriting the newer version.',
    points: ['Discard prompts for unsaved tabs', 'Explorer with right-click create, copy path and confirmed delete', 'Resizable, collapsible explorer and agent panes'] },
  { title: 'History that stays on your machine', media: 'history', alt: 'Recent chats and allowed actions lists',
    text: 'Chats, allowed actions and project memory are saved in local app data. Each chat remembers its folder, so you can pick a conversation back up where it happened.',
    points: ['Recent chats list with delete', 'Allowed actions reviewable and revocable per folder', 'The API key is stored encrypted with the OS credential store'] }
];

function FeatureRow({ f, i }) {
  const flip = i % 2 === 1;
  return (
    <div className={`frow ${flip ? 'flip' : ''}`}>
      <Rise className="ftext">
        <span className="idx">{String(i + 1).padStart(2, '0')} / {String(FEATURES.length).padStart(2, '0')}</span>
        <h3>{f.title}</h3>
        <p className="fp">{f.text}</p>
        <ul>{f.points.map(p => <li key={p}>{p}</li>)}</ul>
      </Rise>
      <div className="fmedia">
        {f.video
          ? <Video src={`media/${f.video}`} poster={`media/f-${f.media}.webp`} aria-label={f.alt} />
          : <img src={`media/f-${f.media}.webp`} alt={f.alt} loading="lazy" />}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="section wrap">
      <Rise as="h2" className="h2">What is in the box</Rise>
      <Rise delay={0.1} className="lead wide">Everything runs locally except the model request itself. Here is each part, in the app.</Rise>
      <div className="frows">{FEATURES.map((f, i) => <FeatureRow key={f.title} f={f} i={i} />)}</div>
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
