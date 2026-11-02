import React, { useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, useScroll, useTransform, useSpring, useInView, useMotionValue, animate, useMotionValueEvent } from 'framer-motion';
import './style.css';

const VERSION = '0.2.0';
const DOWNLOAD = `/download/Code-Agent-${VERSION}-win-x64.exe`;
const REPO = 'https://github.com/sushilbang/code-agent';
const ease = [0.22, 1, 0.36, 1];

const fadeUp = { hidden: { opacity: 0, y: 24 }, show: i => ({ opacity: 1, y: 0, transition: { duration: 0.7, ease, delay: i * 0.08 } }) };

function Reveal({ children, i = 0, className }) {
  return <motion.div className={className} variants={fadeUp} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}>{children}</motion.div>;
}

function Counter({ to, suffix = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const v = useMotionValue(0);
  useMotionValueEvent(v, 'change', n => { if (ref.current) ref.current.textContent = Math.round(n) + suffix; });
  useEffect(() => { if (inView) animate(v, to, { duration: 1.4, ease }); }, [inView]);
  return <span ref={ref}>0{suffix}</span>;
}

function Nav() {
  const { scrollY } = useScroll();
  const bg = useTransform(scrollY, [0, 80], ['rgba(9,9,11,0)', 'rgba(9,9,11,0.82)']);
  const line = useTransform(scrollY, [0, 80], ['rgba(30,30,37,0)', 'rgba(30,30,37,1)']);
  return (
    <motion.header className="nav" style={{ background: bg, borderBottomColor: line }} initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease }}>
      <a className="logo" href="#top"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 8l-5 4 5 4M16 8l5 4-5 4" /></svg>Code Agent</a>
      <nav>
        <a href="#features">Features</a><a href="#safety">Safety</a><a href="#faq">FAQ</a>
        <a className="btn primary sm" href={DOWNLOAD}>Download</a>
      </nav>
    </motion.header>
  );
}

function Hero() {
  const words = ['A', 'coding', 'agent', 'you', 'can'];
  return (
    <section className="hero" id="top">
      <motion.p className="eyebrow" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease }}>v{VERSION} · Windows · Electron + Monaco</motion.p>
      <h1>
        {words.map((w, i) => <motion.span key={i} className="word" initial={{ opacity: 0, y: 40, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.8, ease, delay: 0.1 + i * 0.07 }}>{w}&nbsp;</motion.span>)}
        <motion.em className="word" initial={{ opacity: 0, y: 40, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.8, ease, delay: 0.55 }}>audit.</motion.em>
      </h1>
      <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.7 }}>
        A local editor with an agent that reads your repository, proposes changes as diffs, and waits for your approval. Model requests and secrets never leave the main process.
      </motion.p>
      <motion.div className="cta" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.85 }}>
        <motion.a className="btn primary lg" href={DOWNLOAD} whileHover={{ y: -2, scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 20h16" /></svg>
          Download for Windows
        </motion.a>
        <motion.a className="btn ghost lg" href={REPO} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>View source</motion.a>
      </motion.div>
      <motion.p className="fine" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>Portable .exe · 114 MB · no install · unsigned build</motion.p>
    </section>
  );
}

function Showcase() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 25 });
  const rotateX = useTransform(p, [0, 1], [22, 0]);
  const scale = useTransform(p, [0, 1], [0.88, 1]);
  const opacity = useTransform(p, [0, 0.4], [0.3, 1]);
  return (
    <section className="showcase" ref={ref} style={{ perspective: 1400 }}>
      <motion.div className="frame" style={{ rotateX, scale, opacity, transformOrigin: '50% 100%' }}>
        <div className="frame-bar"><i /><i /><i /><span>Code Agent</span></div>
        <video src="media/demo.mp4" poster="media/poster.png" autoPlay muted loop playsInline preload="metadata" />
      </motion.div>
      <p className="fine">Animated walkthrough rendered from the app's real interface styles.</p>
    </section>
  );
}

const FEATURES = [
  ['⌥', 'Reviewable by default', 'Every file mutation shows a contextual unified diff with Reject, Allow once, and Always allow. The diff stays in the chat afterward.'],
  ['⑂', 'Bounded sub-agents', 'Two or three read-only investigations run in parallel or as a small dependency graph, with isolated context and a shared token budget.'],
  ['◧', 'Context you can see', 'A live token indicator, configurable compaction thresholds, and a record of every file excerpt and memory item sent to the model.'],
  ['✎', 'Project memory', 'Workspace-scoped facts and decisions you control. Add, edit, disable, or delete; credential-looking text is rejected on save.'],
  ['›_', 'Approved commands', 'Executables run directly with an argument array, never through an implicit shell, with timeouts and process-tree cancellation.'],
  ['⎇', 'Git-aware', 'Structured status plus bounded staged and unstaged diffs are available to the agent as read-only tools.'],
  ['❖', 'Monaco editor', 'Tabs, unsaved-change protection, and saves that refuse to overwrite files that changed on disk.'],
  ['↻', 'Local chats', 'Conversations, permissions, and memory persist in local app data and remember their folder.']
];

function Features() {
  return (
    <section id="features" className="section">
      <Reveal><h2>Built for people who read the diff.</h2></Reveal>
      <div className="grid">
        {FEATURES.map(([ico, title, text], i) => (
          <motion.article key={title} className="card" variants={fadeUp} custom={i % 4} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-40px' }} whileHover={{ y: -4 }}>
            <span className="ico">{ico}</span><h3>{title}</h3><p>{text}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

function Safety() {
  const items = ['API key encrypted with the OS credential store (safeStorage)', 'Only key availability is returned to the renderer', 'No generic IPC or Node.js access in the renderer', 'Deletions confirmed and bounded to 200 entries / 10 MB', 'Chats and memory stay in local app data'];
  return (
    <section id="safety" className="section split">
      <Reveal>
        <h2>Security is the architecture.</h2>
        <p className="muted">Electron's renderer, preload, and main-process boundary is preserved. The renderer gets a small typed API, nothing more.</p>
        <div className="stats">
          <div><b><Counter to={41} /></b><span>automated tests</span></div>
          <div><b><Counter to={3} /></b><span>approval choices</span></div>
          <div><b><Counter to={0} /></b><span>secrets in the renderer</span></div>
        </div>
      </Reveal>
      <ul className="checks">
        {items.map((t, i) => <motion.li key={t} initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease, delay: i * 0.08 }}>{t}</motion.li>)}
      </ul>
    </section>
  );
}

function Download() {
  return (
    <section id="download" className="section">
      <Reveal className="dl">
        <div>
          <h2>Run it in a minute.</h2>
          <p className="muted">Download the portable build, double-click, open a folder, and add an OpenAI key from the key icon. Local inspection works without a key.</p>
          <motion.a className="btn primary lg" href={DOWNLOAD} whileHover={{ y: -2, scale: 1.02 }} whileTap={{ scale: 0.98 }}>Download Code-Agent-{VERSION}.exe</motion.a>
          <p className="fine left">Windows 10/11 x64 · 114 MB · portable</p>
        </div>
        <div className="term">
          <div className="term-bar"><i /><i /><i /><span>or build from source</span></div>
          <pre><span className="p">PS&gt;</span> git clone {REPO}.git{'\n'}<span className="p">PS&gt;</span> cd code-agent{'\n'}<span className="p">PS&gt;</span> npm.cmd install{'\n'}<span className="p">PS&gt;</span> npm.cmd start</pre>
        </div>
      </Reveal>
    </section>
  );
}

const FAQ = [
  ['Why does Windows warn me?', 'The build is not code-signed. SmartScreen shows "Windows protected your PC" — choose More info, then Run anyway, or build from source.'],
  ['Where does my API key go?', 'It is encrypted with the operating system credential store and kept in the main process. The renderer only learns whether a key exists.'],
  ['Can the agent change files without asking?', 'Not unless you choose Always allow for a specific action in a specific folder. You can revoke it any time.'],
  ['Which models are supported?', 'OpenAI models from a fixed allowlist, plus a local inspection mode that needs no key.']
];

function Faq() {
  return (
    <section id="faq" className="section">
      <Reveal><h2>Questions</h2></Reveal>
      <div className="faq">
        {FAQ.map(([q, a], i) => <Reveal key={q} i={i}><details><summary>{q}</summary><p>{a}</p></details></Reveal>)}
      </div>
    </section>
  );
}

function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero /><Showcase /><Features /><Safety /><Download /><Faq />
      </main>
      <footer className="foot"><span>© {new Date().getFullYear()} Code Agent</span><a href="https://sushilbang.com">sushilbang.com</a></footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
