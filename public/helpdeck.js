"use strict";(()=>{var U=/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,Y=/^(https?:|mailto:|\/|#)/i;function z(t){let n=document.createDocumentFragment();for(let e of V(t))n.appendChild(Q(e));return n}function V(t){let n=[],e=null,r=null,a=()=>{e&&e.lines.length>0&&n.push(e),e=null};for(let c of t.split(`
`)){if(/^\s*(```|~~~)/.test(c)){r?(n.push(r),r=null):(a(),r={kind:"code",lines:[]});continue}if(r){r.lines.push(c);continue}if(c.trim()===""){a();continue}let s=/^\s*[-*+]\s+(.*)$/.exec(c),p=/^\s*\d+[.)]\s+(.*)$/.exec(c),l=s?"ul":p?"ol":"p",b=s?.[1]??p?.[1]??c;(!e||e.kind!==l)&&(a(),e={kind:l,lines:[]}),e.lines.push(b)}return r&&n.push(r),a(),n}function Q(t){if(t.kind==="code"){let e=document.createElement("pre"),r=document.createElement("code");return r.textContent=t.lines.join(`
`),e.appendChild(r),e}if(t.kind==="ul"||t.kind==="ol"){let e=document.createElement(t.kind);for(let r of t.lines){let a=document.createElement("li");a.appendChild(F(r)),e.appendChild(a)}return e}let n=document.createElement("p");return n.appendChild(F(t.lines.join(" "))),n}function F(t){let n=document.createDocumentFragment();for(let e of t.split(U)){if(!e)continue;if(e.startsWith("**")&&e.endsWith("**")){n.appendChild(W("strong",e.slice(2,-2)));continue}if(e.startsWith("`")&&e.endsWith("`")){n.appendChild(W("code",e.slice(1,-1)));continue}if(e.startsWith("*")&&e.endsWith("*")&&e.length>2){n.appendChild(W("em",e.slice(1,-1)));continue}let r=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(e);if(r){let a=r[2];if(Y.test(a)){let c=document.createElement("a");c.textContent=r[1],c.href=a,c.target="_blank",c.rel="noopener noreferrer",n.appendChild(c)}else n.appendChild(document.createTextNode(r[1]));continue}n.appendChild(document.createTextNode(e))}return n}function W(t,n){let e=document.createElement(t);return e.textContent=n,e}async function I(t,n,e,r){let a;try{a=await fetch(t,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:n.map(l=>({role:l.role,content:l.content}))}),signal:r})}catch{e.onError?.("Could not reach the assistant. Check your connection.");return}if(!a.ok||!a.body){e.onError?.(a.status===429?"Too many messages just now. Give it a moment.":`The assistant is unavailable (${a.status}).`);return}let c=a.body.getReader(),s=new TextDecoder,p="";for(;;){let{done:l,value:b}=await c.read();if(l)break;p+=s.decode(b,{stream:!0});let x=p.split(`

`);p=x.pop()??"";for(let M of x){let g=M.split(`
`).find(k=>k.startsWith("data:"));if(!g)continue;let d;try{d=JSON.parse(g.slice(5).trim())}catch{continue}d.type==="sources"?e.onSources?.(d.sources):d.type==="delta"?e.onDelta?.(d.text):d.type==="done"?e.onDone?.():d.type==="error"&&e.onError?.(d.message)}}e.onDone?.()}var j=`
:host {
  --hd-accent: #2563eb;
  --hd-accent-ink: #ffffff;
  --hd-bg: #ffffff;
  --hd-panel: #ffffff;
  --hd-ink: #111827;
  --hd-muted: #6b7280;
  --hd-line: #e5e7eb;
  --hd-bubble: #f3f4f6;
  --hd-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
  --hd-radius: 16px;
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--hd-ink);
}

:host([data-theme="dark"]) {
  --hd-bg: #0b0f17;
  --hd-panel: #111827;
  --hd-ink: #f3f4f6;
  --hd-muted: #9ca3af;
  --hd-line: #1f2937;
  --hd-bubble: #1f2937;
  --hd-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

*, *::before, *::after { box-sizing: border-box; }

.launcher {
  position: fixed;
  bottom: 20px;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: var(--hd-accent);
  color: var(--hd-accent-ink);
  box-shadow: var(--hd-shadow);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 0.15s ease, opacity 0.15s ease;
  z-index: 2147483000;
}
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible { outline: 3px solid var(--hd-accent); outline-offset: 3px; }
.launcher svg { width: 26px; height: 26px; }

.panel {
  position: fixed;
  bottom: 88px;
  width: min(400px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 120px));
  background: var(--hd-panel);
  border: 1px solid var(--hd-line);
  border-radius: var(--hd-radius);
  box-shadow: var(--hd-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 2147483000;
  opacity: 0;
  transform: translateY(8px) scale(0.98);
  transition: opacity 0.16s ease, transform 0.16s ease;
  pointer-events: none;
}
.panel[data-open="true"] { opacity: 1; transform: none; pointer-events: auto; }

/* Inline mode drops the floating chrome and fills whatever box it was given. */
:host([data-inline="true"]) .panel {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
:host([data-inline="true"]) .launcher { display: none; }

.pos-right { right: 20px; }
.pos-left { left: 20px; }

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--hd-line);
  background: var(--hd-panel);
}
.header h2 { margin: 0; font-size: 15px; font-weight: 600; }
.header p { margin: 2px 0 0; font-size: 12.5px; color: var(--hd-muted); }
.header .grow { flex: 1; min-width: 0; }
.header h2, .header p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.icon-button {
  border: 0;
  background: transparent;
  color: var(--hd-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: grid;
  place-items: center;
}
.icon-button:hover { background: var(--hd-bubble); color: var(--hd-ink); }
.icon-button:focus-visible { outline: 2px solid var(--hd-accent); outline-offset: 1px; }
.icon-button svg { width: 18px; height: 18px; }

.log {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.msg { display: flex; flex-direction: column; gap: 6px; max-width: 88%; }
.msg[data-role="user"] { align-self: flex-end; align-items: flex-end; }

.bubble {
  padding: 10px 13px;
  border-radius: 14px;
  background: var(--hd-bubble);
  overflow-wrap: anywhere;
}
.msg[data-role="user"] .bubble {
  background: var(--hd-accent);
  color: var(--hd-accent-ink);
  border-bottom-right-radius: 4px;
}
.msg[data-role="assistant"] .bubble { border-bottom-left-radius: 4px; }

.bubble p { margin: 0 0 8px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble ul, .bubble ol { margin: 0 0 8px; padding-left: 20px; }
.bubble li { margin: 2px 0; }
.bubble code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
  background: rgba(127, 127, 127, 0.16);
  padding: 1px 5px;
  border-radius: 5px;
}
.bubble pre {
  margin: 0 0 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.14);
  overflow-x: auto;
}
.bubble pre code { background: none; padding: 0; }
.bubble a { color: inherit; text-underline-offset: 2px; }

.sources { display: flex; flex-wrap: wrap; gap: 6px; }
.sources a, .sources span {
  font-size: 11.5px;
  color: var(--hd-muted);
  border: 1px solid var(--hd-line);
  border-radius: 999px;
  padding: 3px 9px;
  text-decoration: none;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sources a:hover { color: var(--hd-ink); border-color: var(--hd-muted); }

.suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 12px; }
.suggestions button {
  font: inherit;
  font-size: 13px;
  color: var(--hd-ink);
  background: var(--hd-panel);
  border: 1px solid var(--hd-line);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
}
.suggestions button:hover { border-color: var(--hd-accent); color: var(--hd-accent); }
.suggestions button:focus-visible { outline: 2px solid var(--hd-accent); outline-offset: 1px; }

.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--hd-line);
}
.composer textarea {
  flex: 1;
  font: inherit;
  color: var(--hd-ink);
  background: var(--hd-bg);
  border: 1px solid var(--hd-line);
  border-radius: 12px;
  padding: 9px 12px;
  resize: none;
  max-height: 120px;
  min-height: 40px;
}
.composer textarea:focus { outline: 2px solid var(--hd-accent); outline-offset: -1px; }
.composer button[type="submit"] {
  border: 0;
  border-radius: 12px;
  width: 40px;
  height: 40px;
  background: var(--hd-accent);
  color: var(--hd-accent-ink);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: none;
}
.composer button[type="submit"]:disabled { opacity: 0.45; cursor: default; }
.composer button svg { width: 18px; height: 18px; }

.typing { display: inline-flex; gap: 4px; padding: 3px 0; }
.typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hd-muted);
  animation: hd-blink 1.2s infinite ease-in-out;
}
.typing i:nth-child(2) { animation-delay: 0.15s; }
.typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes hd-blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

.footer {
  padding: 0 16px 10px;
  font-size: 11px;
  color: var(--hd-muted);
  text-align: center;
}
.footer a { color: inherit; }

.error {
  margin: 0 16px 12px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
}
:host([data-theme="dark"]) .error { color: #fca5a5; background: #2a1214; border-color: #7f1d1d; }

@media (prefers-reduced-motion: reduce) {
  .panel, .launcher, .typing i { transition: none; animation: none; }
}
`;function J(t){return`helpdeck:transcript:${t}`}var D={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z"};function P(t){if(!t.endpoint)throw new Error("helpdeck: an `endpoint` is required");let n=!!t.target,e=document.createElement("div");e.setAttribute("data-helpdeck",""),n&&e.setAttribute("data-inline","true"),e.style.cssText=n?"display:block;width:100%;height:100%":"";let r=e.attachShadow({mode:"open"}),a=document.createElement("style");a.textContent=j,r.appendChild(a),t.accent&&e.style.setProperty("--hd-accent",t.accent),X(e,t.theme??"auto");let c=t.position==="bottom-left"?"pos-left":"pos-right",s={messages:t.persist===!1?[]:Z(t.endpoint),busy:!1,controller:null},p=document.createElement("button");p.className=`launcher ${c}`,p.type="button",p.setAttribute("aria-label","Open the support chat"),p.setAttribute("aria-expanded","false"),p.appendChild(B(D.chat,!0));let l=document.createElement("div");l.className=`panel ${c}`,l.setAttribute("role","dialog"),l.setAttribute("aria-modal","false"),l.setAttribute("aria-label",t.title??"Support chat"),l.dataset.open=String(n||t.open===!0);let b=document.createElement("div");b.className="header";let x=document.createElement("div");x.className="grow";let M=document.createElement("h2");if(M.textContent=t.title??"Ask us anything",x.appendChild(M),t.subtitle){let o=document.createElement("p");o.textContent=t.subtitle,x.appendChild(o)}b.appendChild(x);let g=document.createElement("button");g.className="icon-button",g.type="button",g.setAttribute("aria-label","Close the support chat"),g.appendChild(B(D.close,!1)),n||b.appendChild(g);let d=document.createElement("div");d.className="log",d.setAttribute("role","log"),d.setAttribute("aria-live","polite"),d.setAttribute("aria-relevant","additions text");let k=document.createElement("div");k.className="suggestions";let v=document.createElement("div");v.className="error",v.hidden=!0,v.setAttribute("role","alert");let E=document.createElement("form");E.className="composer";let m=document.createElement("textarea");m.rows=1,m.placeholder="Type your question",m.setAttribute("aria-label","Your question");let C=document.createElement("button");C.type="submit",C.setAttribute("aria-label","Send"),C.appendChild(B(D.send,!0)),E.append(m,C),l.append(b,d,k,v,E),n?r.append(l):r.append(p,l),(t.target??document.body).appendChild(e);function S(o){l.dataset.open=String(o),p.setAttribute("aria-expanded",String(o)),p.setAttribute("aria-label",o?"Close the support chat":"Open the support chat"),o?m.focus():p.focus()}function K(o){v.textContent=o,v.hidden=!1}function L(){d.scrollTop=d.scrollHeight}function G(o,i){let u=new Set;for(let y of i.matchAll(/\[(\d{1,2})\]/g))u.add(Number.parseInt(y[1],10)-1);let f=o.filter((y,h)=>u.has(h));return f.length>0?f:o}function H(o,i){if(i.length===0)return;let u=document.createElement("div");u.className="sources";for(let f of i.slice(0,4)){let y=f.section?`${f.title} \xB7 ${f.section}`:f.title,h=document.createElement(f.url?"a":"span");h.textContent=y,f.url&&h instanceof HTMLAnchorElement&&(h.href=f.url,h.target="_blank",h.rel="noopener noreferrer"),u.appendChild(h)}o.appendChild(u)}function N(o){let i=document.createElement("div");i.className="msg",i.dataset.role=o.role;let u=document.createElement("div");return u.className="bubble",o.role==="user"?u.textContent=o.content:u.appendChild(z(o.content)),i.appendChild(u),o.sources&&H(i,o.sources),d.appendChild(i),L(),{bubble:u,wrapper:i}}function T(){if(k.replaceChildren(),!(s.messages.length>0||!t.suggestions?.length))for(let o of t.suggestions.slice(0,4)){let i=document.createElement("button");i.type="button",i.textContent=o,i.addEventListener("click",()=>{O(o)}),k.appendChild(i)}}function R(){d.replaceChildren(),t.greeting&&N({role:"assistant",content:t.greeting});for(let o of s.messages)N(o);T()}async function O(o){let i=o.trim();if(!i||s.busy)return;v.hidden=!0,s.busy=!0,C.disabled=!0;let u={role:"user",content:i};s.messages.push(u),N(u),T();let{bubble:f,wrapper:y}=N({role:"assistant",content:""}),h=document.createElement("span");h.className="typing",h.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),f.appendChild(h);let w={role:"assistant",content:""},$=[];s.controller=new AbortController,await I(t.endpoint,s.messages,{onSources:A=>{$=A},onDelta:A=>{h.remove(),w.content+=A,f.replaceChildren(z(w.content)),L()},onError:A=>{h.remove(),K(A)}},s.controller.signal),h.remove(),w.content.trim()?(w.sources=G($,w.content),s.messages.push(w),H(y,w.sources),q(t.endpoint,s.messages,t.persist!==!1)):(y.remove(),s.messages.pop(),T()),s.busy=!1,C.disabled=!1,s.controller=null,L(),m.focus()}return p.addEventListener("click",()=>S(l.dataset.open!=="true")),g.addEventListener("click",()=>S(!1)),E.addEventListener("submit",o=>{o.preventDefault();let i=m.value;m.value="",m.style.height="auto",O(i)}),m.addEventListener("input",()=>{m.style.height="auto",m.style.height=`${m.scrollHeight}px`}),m.addEventListener("keydown",o=>{o.key==="Enter"&&!o.shiftKey&&(o.preventDefault(),E.requestSubmit())}),r.addEventListener("keydown",o=>{o.key==="Escape"&&!n&&S(!1)}),R(),{open:()=>S(!0),close:()=>S(!1),ask:O,clear(){s.messages=[],q(t.endpoint,[],t.persist!==!1),R()},destroy(){s.controller?.abort(),e.remove()},element:e}}function X(t,n){if(n!=="auto"){t.setAttribute("data-theme",n);return}let e=window.matchMedia("(prefers-color-scheme: dark)"),r=()=>t.setAttribute("data-theme",e.matches?"dark":"light");r(),e.addEventListener("change",r)}function B(t,n){let e=document.createElementNS("http://www.w3.org/2000/svg","svg");e.setAttribute("viewBox","0 0 24 24"),e.setAttribute("aria-hidden","true"),e.setAttribute("fill",n?"currentColor":"none"),e.setAttribute("stroke",n?"none":"currentColor"),e.setAttribute("stroke-width","2"),e.setAttribute("stroke-linecap","round");let r=document.createElementNS("http://www.w3.org/2000/svg","path");return r.setAttribute("d",t),e.appendChild(r),e}function Z(t){try{let n=sessionStorage.getItem(J(t));return n?JSON.parse(n):[]}catch{return[]}}function q(t,n,e){if(e)try{sessionStorage.setItem(J(t),JSON.stringify(n.slice(-20)))}catch{}}function ee(){let n=document.currentScript?.dataset??{},e=n.endpoint??window.helpdeckConfig?.endpoint;if(!e)return console.warn("[helpdeck] no data-endpoint on the script tag, widget not mounted"),null;let r=n.target?document.querySelector(n.target):null;return{endpoint:e,title:n.title,subtitle:n.subtitle,greeting:n.greeting,accent:n.accent,suggestions:n.suggestions?.split("|").map(a=>a.trim()).filter(Boolean),position:n.position==="bottom-left"?"bottom-left":"bottom-right",theme:n.theme==="dark"||n.theme==="light"?n.theme:"auto",open:n.open==="true",persist:n.persist!=="false",...window.helpdeckConfig,...r?{target:r}:{}}}var _=ee();if(_){let t=()=>{window.helpdeck=P(_)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",t,{once:!0}):t()}})();
