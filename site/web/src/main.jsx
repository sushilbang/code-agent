import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './style.css';

gsap.registerPlugin(ScrollTrigger);

const VERSION = '0.2.0';
const DOWNLOAD = `/download/Code-Agent-${VERSION}-win-x64.exe`;
const SHA = 'db52ed94103654e6e3a9aca5433584928ed27a7d84f77468e869a2496447afc1';
const REPO = 'https://github.com/sushilbang/code-agent';

/* Plays only while on screen, so offscreen videos cost nothing. */
function Video(props) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { rootMargin: '120px' });
    io.observe(v);
    return () => io.disconnect();
  }, []);
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

/* *word* marks an accent. Each word is a span so GSAP can light them up on scroll. */
function ScrollReveal({ text }) {
  return (
    <p className="reveal">
      {text.split(' ').map((raw, i) => <React.Fragment key={i}><span className={`w${raw.startsWith('*') ? ' acc' : ''}`}>{raw.replaceAll('*', '')}</span>{' '}</React.Fragment>)}
    </p>
  );
}

function Nav() {
  return (
    <header className="nav">
      <a className="logo" href="#top"><img className="mark" src="favicon.svg" alt="" width="28" height="28" /> Code Agent</a>
      <nav>
        <a href="#how">How it works</a><a href="#features">Features</a><a href="#safety">Safety</a><a href="#faq">FAQ</a>
        <a className="pill" href={DOWNLOAD}>Download</a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <GradientBg />
      <div className="wrap">
        <p className="kicker">Desktop app for Windows — v{VERSION}</p>
        <h1>
          <span className="line"><span>A coding agent</span></span>
          <span className="line"><span>you can <em>audit.</em></span></span>
        </h1>
        <p className="sub">An editor and an agent in one window. It reads your repository, proposes every change as a diff, and does nothing until you say so.</p>
        <div className="cta">
          <a className="btn solid" href={DOWNLOAD}>Download for Windows <span>↓</span></a>
          <a className="btn line" href={REPO}>Source on GitHub</a>
        </div>
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
      <h2 className="h2">How an edit happens</h2>
      <div className="steps">
        <div className="rule" aria-hidden="true" />
        {STEPS.map(([n, t, d]) => (
          <div key={n} className="step"><span className="num">{n}</span><h3>{t}</h3><p>{d}</p></div>
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
  { title: 'Context you can see', media: 'context', video: 'clip-context.mp4', alt: 'The Context usage dialog with working budget, warning and compaction thresholds',
    text: 'A live indicator above the composer shows input tokens for the latest request. Set a working budget and the thresholds at which it warns and the provider compacts the run.',
    points: ['API-reported counts replace local estimates when they arrive', 'Every file excerpt and memory item sent is listed on the message', 'The budget is a planning preference, not the model limit'] },
  { title: 'Project memory you control', media: 'memory', video: 'clip-memory.mp4', alt: 'The Project memory panel with saved facts, each with a Use toggle, Edit and Delete',
    text: 'Save facts and decisions for a workspace and relevant ones are included in new runs. They live beside, not inside, your chats — so you can correct or remove them without touching history.',
    points: ['Add, edit, disable or delete any item', 'Credential-looking text is rejected on save', 'Stored locally and unencrypted — keep secrets out'] },
  { title: 'Commands, without a shell', media: 'commands', video: 'clip-commands.mp4', alt: 'A run command approval showing the executable and its argument array',
    text: 'Approved commands run an executable directly with a separate argument array — there is no implicit shell to interpret surprises. Package diagnostics only pick an existing test, lint, check or build script.',
    points: ['Approval required every time', 'Workspace-contained working directory, bounded streamed output', 'Timeouts and process-tree termination on cancel'] },
  { title: 'Git, read-only', media: 'git', video: 'clip-git.mp4', alt: 'git_status and git_diff tool steps listing staged and unstaged changes',
    text: 'The agent can see what you have changed without being able to change it. Status is structured, and staged or unstaged diffs are bounded by file, result and size limits.',
    points: ['Ask “what have I changed?” and get an answer from the real tree', 'Nothing is staged, committed or reset by these tools'] },
  { title: 'A real editor, careful with your files', media: 'editor', video: 'clip-editor.mp4', alt: 'The Monaco editor with three tabs and a refused save after an on-disk change',
    text: 'Monaco handles the editing: tabs, syntax highlighting, and unsaved-change markers. If a file changed on disk since you opened it, saving is refused instead of overwriting the newer version.',
    points: ['Discard prompts for unsaved tabs', 'Explorer with right-click create, copy path and confirmed delete', 'Resizable, collapsible explorer and agent panes'] },
  { title: 'History that stays on your machine', media: 'history', video: 'clip-history.mp4', alt: 'Recent chats and allowed actions lists',
    text: 'Chats, allowed actions and project memory are saved in local app data. Each chat remembers its folder, so you can pick a conversation back up where it happened.',
    points: ['Recent chats list with delete', 'Allowed actions reviewable and revocable per folder', 'The API key is stored encrypted with the OS credential store'] }
];

function FeatureRow({ f, i }) {
  const flip = i % 2 === 1;
  return (
    <div className={`frow ${flip ? 'flip' : ''}`}>
      <div className="ftext">
        <span className="idx">{String(i + 1).padStart(2, '0')} / {String(FEATURES.length).padStart(2, '0')}</span>
        <h3>{f.title}</h3>
        <p className="fp">{f.text}</p>
        <ul>{f.points.map(p => <li key={p}>{p}</li>)}</ul>
      </div>
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
      <h2 className="h2">What is in the box</h2>
      <p className="lead wide">Everything runs locally except the model request itself. Here is each part, in the app.</p>
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
      <h2 className="h2">Where the lines are drawn</h2>
      <dl className="spec">
        <div className="rule" aria-hidden="true" />
        {SAFETY.map(([k, v]) => <div key={k} className="spec-row"><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}

function Download() {
  return (
    <section id="download" className="dl">
      <GradientBg />
      <div className="wrap dl-in">
        <h2 className="h2 big">Try it on a repo<br />you care about.</h2>
        <div className="dl-card">
          <a className="btn solid" href={DOWNLOAD}>Download Code-Agent-{VERSION}.exe <span>↓</span></a>
          <dl className="meta">
            <div><dt>Platform</dt><dd>Windows 10/11, x64</dd></div>
            <div><dt>Size</dt><dd>114 MB, portable, no installer</dd></div>
            <div><dt>SHA-256</dt><dd className="mono">{SHA}</dd></div>
            <div><dt>Signing</dt><dd>Unsigned — SmartScreen will warn</dd></div>
          </dl>
        </div>
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
      <h2 className="h2">Questions</h2>
      <div className="faq">
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><div className="ans"><p>{a}</p></div></details>)}
      </div>
    </section>
  );
}

/* All motion lives here. Only transform and opacity are animated, except one-shot clip-paths. */
function useMotion(root) {
  useLayoutEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const q = s => gsap.utils.toArray(s, root.current);
      const once = (trigger, start = 'top 85%') => ({ trigger, start, once: true });

      // Nav turns solid after the first screen of scrolling.
      ScrollTrigger.create({ start: 80, end: 'max', toggleClass: { targets: root.current.querySelector('.nav'), className: 'on' } });

      // Hero entrance.
      gsap.timeline({ defaults: { ease: 'expo.out' } })
        .from('.hero .kicker', { opacity: 0, y: 14, duration: 0.9 })
        .from('.hero h1 .line > span', { yPercent: 115, duration: 1.3, stagger: 0.12 }, 0.1)
        .from('.hero .sub', { opacity: 0, y: 18, duration: 1 }, 0.55)
        .from('.hero .cta > *', { opacity: 0, y: 18, duration: 0.9, stagger: 0.08 }, 0.7);

      // Manifesto: words light up as you scroll through the paragraph.
      gsap.fromTo('.reveal .w', { opacity: 0.16 }, {
        opacity: 1, ease: 'none', stagger: 0.12,
        scrollTrigger: { trigger: '.reveal', start: 'top 80%', end: 'bottom 45%', scrub: true }
      });

      // Section headings and lead text.
      q('.h2').forEach(h => gsap.from(h, { opacity: 0, y: 36, duration: 1, ease: 'expo.out', scrollTrigger: once(h) }));
      q('.lead').forEach(p => gsap.from(p, { opacity: 0, y: 20, duration: 0.9, delay: 0.1, ease: 'expo.out', scrollTrigger: once(p) }));

      // Hairlines draw in, then their items follow.
      q('.rule').forEach(r => gsap.from(r, { scaleX: 0, transformOrigin: 'left center', duration: 1.2, ease: 'expo.inOut', scrollTrigger: once(r.parentElement) }));
      gsap.from('.step', { opacity: 0, y: 30, duration: 0.9, stagger: 0.12, ease: 'expo.out', scrollTrigger: once('.steps') });
      gsap.from('.spec-row', { opacity: 0, x: -24, duration: 0.8, stagger: 0.08, ease: 'expo.out', scrollTrigger: once('.spec') });

      // Feature rows: text staggers up, the screenshot unmasks.
      q('.frow').forEach(row => {
        const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, scrollTrigger: once(row, 'top 78%') });
        tl.from(row.querySelectorAll('.idx, h3, .fp'), { opacity: 0, y: 28, duration: 1, stagger: 0.09 })
          .from(row.querySelectorAll('li'), { opacity: 0, x: -14, duration: 0.8, stagger: 0.07 }, 0.35)
          .fromTo(row.querySelector('.fmedia'), { clipPath: 'inset(7% 7% 7% 7% round 14px)', opacity: 0, scale: 1.05 },
            { clipPath: 'inset(0% 0% 0% 0% round 12px)', opacity: 1, scale: 1, duration: 1.4 }, 0);
      });

      // Download block.
      gsap.from('.dl-card', { opacity: 0, y: 40, duration: 1.1, ease: 'expo.out', scrollTrigger: once('.dl-card', 'top 88%') });
      gsap.from('.meta > div', { opacity: 0, y: 12, duration: 0.7, stagger: 0.08, ease: 'power3.out', scrollTrigger: once('.dl-card', 'top 80%') });

      // FAQ: answers ease open instead of snapping.
      q('.faq details').forEach(d => {
        const ans = d.querySelector('.ans');
        d.querySelector('summary').addEventListener('click', e => {
          e.preventDefault();
          if (d.open) gsap.to(ans, { height: 0, opacity: 0, duration: 0.35, ease: 'power2.inOut', onComplete: () => { d.open = false; } });
          else { d.open = true; gsap.fromTo(ans, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.45, ease: 'power3.out' }); }
        });
      });

      // Buttons lean slightly toward the cursor.
      q('.btn.solid').forEach(b => {
        const x = gsap.quickTo(b, 'x', { duration: 0.4, ease: 'power3' }), y = gsap.quickTo(b, 'y', { duration: 0.4, ease: 'power3' });
        b.addEventListener('mousemove', e => { const r = b.getBoundingClientRect(); x((e.clientX - r.left - r.width / 2) * 0.12); y((e.clientY - r.top - r.height / 2) * 0.25); });
        b.addEventListener('mouseleave', () => { x(0); y(0); });
      });
    });
    return () => mm.revert();
  }, []);
}

function App() {
  const root = useRef(null);
  useMotion(root);
  return (
    <div ref={root}>
      <Nav />
      <main><Hero /><Showcase /><Manifesto /><How /><Features /><Safety /><Download /><Faq /></main>
      <footer className="foot wrap"><span>Code Agent {VERSION}</span><span><a href={REPO}>GitHub</a> · <a href="https://sushilbang.com">sushilbang.com</a></span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
