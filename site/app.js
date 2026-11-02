document.getElementById('y').textContent = new Date().getFullYear();

const chat = document.getElementById('chat');
const script = [
  { html: '<div class="m-user"><div class="m-label">You</div><div class="bubble">Raise the default sub-agent budget to 30k tokens.</div></div>' },
  { html: '<div class="step"><span>search_files · SUBAGENT_BUDGET</span><b>Done</b></div>' },
  { html: '<div class="step"><span>read_file · src/electron/agent/subagents.ts</span><b>Done</b></div>' },
  { html: '<div><div class="m-label">Agent</div>The default lives in one constant. I’ll change it and leave the per-child limits alone.</div>' },
  { html: '<div class="approve"><strong>edit file</strong><div class="diff"><div class="r">-export const SUBAGENT_BUDGET = 20_000;</div><div class="a">+export const SUBAGENT_BUDGET = 30_000;</div></div><div class="acts"><span>Reject</span><span>Allow once</span><span class="p">Always allow</span></div></div>' }
];

let timer;
function play() {
  chat.innerHTML = '';
  let i = 0;
  const next = () => {
    if (i >= script.length) { timer = setTimeout(play, 6000); return; }
    const el = document.createElement('div');
    el.className = 'fade-in';
    el.innerHTML = script[i++].html;
    chat.appendChild(el);
    timer = setTimeout(next, 1100);
  };
  next();
}

if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  script.forEach(s => { const el = document.createElement('div'); el.innerHTML = s.html; chat.appendChild(el); });
} else {
  play();
}
