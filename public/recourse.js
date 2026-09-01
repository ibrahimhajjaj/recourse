"use strict";(()=>{var rt=/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,ot=/^(https?:|mailto:|\/|#)/i;function Y(e){let t=document.createDocumentFragment();for(let n of it(e))t.appendChild(at(n));return t}function it(e){let t=[],n=null,o=null,l=()=>{n&&n.lines.length>0&&t.push(n),n=null};for(let s of e.split(`
`)){if(/^\s*(```|~~~)/.test(s)){o?(t.push(o),o=null):(l(),o={kind:"code",lines:[]});continue}if(o){o.lines.push(s);continue}if(s.trim()===""){l();continue}let c=/^\s*[-*+]\s+(.*)$/.exec(s),a=/^\s*\d+[.)]\s+(.*)$/.exec(s),p=c?"ul":a?"ol":"p",g=c?.[1]??a?.[1]??s;(!n||n.kind!==p)&&(l(),n={kind:p,lines:[]}),n.lines.push(g)}return o&&t.push(o),l(),t}function at(e){if(e.kind==="code"){let n=document.createElement("pre"),o=document.createElement("code");return o.textContent=e.lines.join(`
`),n.appendChild(o),n}if(e.kind==="ul"||e.kind==="ol"){let n=document.createElement(e.kind);for(let o of e.lines){let l=document.createElement("li");l.appendChild(we(o)),n.appendChild(l)}return n}let t=document.createElement("p");return t.appendChild(we(e.lines.join(" "))),t}function we(e){let t=document.createDocumentFragment();for(let n of e.split(rt)){if(!n)continue;if(n.startsWith("**")&&n.endsWith("**")){t.appendChild(le("strong",n.slice(2,-2)));continue}if(n.startsWith("`")&&n.endsWith("`")){t.appendChild(le("code",n.slice(1,-1)));continue}if(n.startsWith("*")&&n.endsWith("*")&&n.length>2){t.appendChild(le("em",n.slice(1,-1)));continue}let o=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(n);if(o){let l=o[2];if(ot.test(l)){let s=document.createElement("a");s.textContent=o[1],s.href=l,s.target="_blank",s.rel="noopener noreferrer",t.appendChild(s)}else t.appendChild(document.createTextNode(o[1]));continue}t.appendChild(document.createTextNode(n))}return t}function le(e,t){let n=document.createElement(e);return n.textContent=t,n}var de=/^(https?:|mailto:|tel:|\/|#)/i;function ce(e,t){let n=e.showIf;if(n===void 0)return!0;if(typeof n=="boolean")return n;if(typeof n=="string"){let o=n.startsWith("!"),l=o?n.slice(1):n,[s,c]=l.split("=",2),a=t[(s??"").trim()],p=c===void 0?!!a:String(a)===c.trim();return o?!p:p}return!0}function R(e,t,n){let o=document.createElement(e);return o.textContent=t,n&&(o.className=n),o}function C(e){return typeof e=="string"?e:e==null?"":String(e)}function ke(e,t,n){if(!de.test(t))return R("span",e,n);let o=document.createElement("a");return o.textContent=e,o.href=t,o.target="_blank",o.rel="noopener noreferrer",o.className=n,o}var st=e=>{let t=C(e.label)||"Open",n=C(e.url);if(!n)return null;let o=document.createElement("div");return o.className="ui-actions",o.appendChild(ke(t,n,"ui-button")),o};function lt(e,t){let n=C(e.label);if(!n)return null;if(e.url)return ke(n,C(e.url),"ui-button");let o=document.createElement("button");return o.type="button",o.className="ui-button",o.textContent=n,e.run?(o.addEventListener("click",async()=>{if(t.run){o.disabled=!0;try{await t.run(C(e.run),e.payload??{}),o.replaceWith(R("span",C(e.done)||"Done","ui-muted"))}catch(l){o.disabled=!1,o.textContent=l instanceof Error?l.message:"That did not work"}}}),o):(o.addEventListener("click",()=>t.submit(C(e.send)||n)),o)}var ct=(e,t)=>{let n=document.createElement("div");if(n.className="ui-card",e.image&&de.test(C(e.image))){let c=document.createElement("img");c.src=C(e.image),c.alt=C(e.title),c.loading="lazy",c.className="ui-card-image",n.appendChild(c)}let o=document.createElement("div");o.className="ui-card-body",e.title&&o.appendChild(R("h3",C(e.title))),e.subtitle&&o.appendChild(R("p",C(e.subtitle),"ui-muted"));let l=(Array.isArray(e.fields)?e.fields:[]).filter(c=>ce(c,e));if(l.length>0){let c=document.createElement("dl");c.className="ui-fields";for(let a of l){let p=a;c.appendChild(R("dt",C(p.label))),c.appendChild(R("dd",C(p.value)))}o.appendChild(c)}let s=(Array.isArray(e.actions)?e.actions:[]).filter(c=>ce(c,e));if(s.length>0){let c=document.createElement("div");c.className="ui-actions";for(let a of s){let p=lt(a,t);p&&c.appendChild(p)}c.childElementCount>0&&o.appendChild(c)}return n.appendChild(o),n},dt=e=>{let t=(Array.isArray(e.columns)?e.columns:[]).map(C),n=Array.isArray(e.rows)?e.rows:[];if(t.length===0||n.length===0)return null;let o=document.createElement("div");o.className="ui-table-wrap";let l=document.createElement("table");l.className="ui-table";let s=document.createElement("thead"),c=document.createElement("tr");for(let p of t)c.appendChild(R("th",p));s.appendChild(c),l.appendChild(s);let a=document.createElement("tbody");for(let p of n.slice(0,25)){let g=document.createElement("tr"),u=Array.isArray(p)?p:t.map(b=>p[b]);for(let b of u)g.appendChild(R("td",C(b)));a.appendChild(g)}return l.appendChild(a),o.appendChild(l),o},ut=(e,t)=>{let n=(Array.isArray(e.items)?e.items:[]).filter(l=>ce(l,e));if(n.length===0)return null;let o=document.createElement("div");o.className="ui-list";for(let l of n){let s=l,c=C(s.title);if(!c)continue;let a=document.createElement(s.url?"a":"button");a.className="ui-list-item",a instanceof HTMLAnchorElement&&de.test(C(s.url))?(a.href=C(s.url),a.target="_blank",a.rel="noopener noreferrer"):a instanceof HTMLButtonElement&&(a.type="button",a.addEventListener("click",()=>t.submit(C(s.send)||c))),a.appendChild(R("span",c,"ui-list-title")),s.subtitle&&a.appendChild(R("span",C(s.subtitle),"ui-muted")),o.appendChild(a)}return o.childElementCount>0?o:null};function Ce(e,t){let n=document.createElement("form");n.className="ui-form",e.title&&n.appendChild(R("h3",e.title));let o=Array.isArray(e.fields)?e.fields:[],l=[];for(let a of o){let p=a,g=C(p.name);if(!g)continue;let u=document.createElement("label");u.className="ui-field",u.appendChild(R("span",C(p.label)||g));let b;if(Array.isArray(p.options)&&p.options.length>0){let x=document.createElement("select");for(let v of p.options){let m=document.createElement("option");m.value=C(v),m.textContent=C(v),x.appendChild(m)}b=x}else if(p.type==="boolean"){let x=document.createElement("input");x.type="checkbox",b=x}else{let x=document.createElement("input");x.type=p.type==="number"?"number":"text",p.placeholder&&(x.placeholder=C(p.placeholder)),b=x}b.name=g,p.required!==!1&&b instanceof HTMLInputElement&&b.type!=="checkbox"&&(b.required=!0),u.appendChild(b),n.appendChild(u),l.push({name:g,element:b})}let s=document.createElement("button");s.type="submit",s.className="ui-button",s.textContent=e.submitLabel||"Send",n.appendChild(s);let c=!1;return n.addEventListener("submit",a=>{if(a.preventDefault(),c)return;c=!0;let p={};for(let{name:g,element:u}of l)p[g]=u instanceof HTMLInputElement&&u.type==="checkbox"?u.checked:u.value;n.replaceChildren(Y("Thanks, sending that now.")),t.respond(p)}),n}var pt={button:st,card:ct,table:dt,list:ut};function Ee(e,t){let n=pt[e.kind];return n?n(e.data,t):null}var mt={offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status})."};async function Se(e,t,n,o,l=mt){let s;try{s=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,messages:t.messages.map(g=>({role:g.role,content:g.content}))}),signal:o})}catch{n.onError?.(l.offline);return}if(!s.ok||!s.body){n.onError?.(s.status===429?l.rateLimited:l.unavailable.replace("{status}",String(s.status)));return}let c=s.body.getReader(),a=new TextDecoder,p="";for(;;){let{done:g,value:u}=await c.read();if(g)break;p+=a.decode(u,{stream:!0});let b=p.split(`

`);p=b.pop()??"";for(let x of b){let v=x.split(`
`).find(k=>k.startsWith("data:"));if(!v)continue;let m;try{m=JSON.parse(v.slice(5).trim())}catch{continue}n.onFrame?.(m),m.type==="sources"?n.onSources?.(m.sources):m.type==="delta"?n.onDelta?.(m.text):m.type==="done"?n.onDone?.():m.type==="error"&&n.onError?.(m.message)}}n.onDone?.()}function ft(e=globalThis){let t=e;return t.SpeechRecognition??t.webkitSpeechRecognition??null}var gt={"not-allowed":"I need permission to use the microphone. You can allow it in your browser settings.","service-not-allowed":"Your browser would not let me use speech recognition.","no-speech":"I did not hear anything. Try again?","audio-capture":"I could not find a microphone.",network:"Speech recognition needs a connection and could not reach it.","language-not-supported":"Speech recognition is not available for this language on your device."};function Ae(e={},t=globalThis){let n=ft(t);if(!n)return null;let o=n,l=null,s=!1;function c(g){let u=new o;u.continuous=!0,u.interimResults=!0,u.maxAlternatives=1;let b=e.lang??ht(t);return b&&(u.lang=b),g&&(u.processLocally=!0),u}function a(g){g.onstart=()=>e.onStateChange?.(!0),g.onresult=u=>{let b="";for(let x=u.resultIndex;x<u.results.length;x++){let v=u.results[x];if(!v)continue;let m=v[0]?.transcript??"";v.isFinal?e.onFinal?.(m):b+=m}b&&e.onInterim?.(b)},g.onerror=u=>{let b=e.processLocally!==!1,x=u.error==="language-not-supported"||u.error==="service-not-allowed";if(b&&x&&e.allowCloudFallback&&!s){s=!0,l=null,p(!1);return}u.error!=="aborted"&&e.onError?.(gt[u.error]??"Speech recognition stopped unexpectedly.")},g.onend=()=>{l=null,e.onStateChange?.(!1)}}function p(g){let u=c(g);a(u),l=u;try{u.start()}catch{l=null,e.onStateChange?.(!1)}}return{get recording(){return l!==null},start(){l||(s=!1,p(e.processLocally!==!1))},stop(){l?.stop()},cancel(){let g=l;l=null,g?.abort(),e.onStateChange?.(!1)},toggle(){l?this.stop():this.start()}}}function ht(e){return e.document?.documentElement?.lang??""}function Te(e){let t=e.fetch??globalThis.fetch.bind(globalThis),n=e.load??vt,o="idle",l=null,s=0,c=u=>{o!==u&&(o=u,e.onStateChange?.(u))},a=u=>{c("failed"),e.onError?.(u)};async function p(){if(o==="connecting"||o==="live")return;let u=++s;c("connecting");let b;try{let v=await t(e.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:e.conversationId()})});if(v.status===429){u===s&&a("Too many calls just now. Try again in a moment.");return}if(!v.ok){u===s&&a("Calling is not available right now.");return}let m=await v.json();if(typeof m.signedUrl!="string"||!m.signedUrl){u===s&&a("Calling is not available right now.");return}b=m.signedUrl}catch{u===s&&a("Could not reach the server to start the call.");return}if(u!==s)return;let x;try{x=await n()}catch{u===s&&a("Could not load the voice connection.");return}if(u===s)try{let v=await x.startSession({signedUrl:b,onConnect:()=>{u===s&&c("live")},onDisconnect:()=>{u===s&&(l=null,c("ended"))},onError:()=>{u===s&&a("The call ended unexpectedly. Your microphone may be blocked.")},onMessage:m=>{let k=typeof m?.message=="string"?m.message.trim():"";k&&e.onTranscript?.({role:m.source==="user"?"visitor":"agent",text:k})}});if(u!==s){await Promise.resolve(v.endSession()).catch(()=>{});return}l=v}catch{u===s&&a("Could not start the call. Your microphone may be blocked.")}}async function g(){s++;let u=l;if(l=null,u)try{await u.endSession()}catch{}c(o==="failed"?"failed":"ended")}return{get state(){return o},start:p,stop:g,async toggle(){o==="connecting"||o==="live"?await g():await p()}}}var bt="https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";async function vt(){let t=await import(bt);if(!t.Conversation)throw new Error("no conversation runtime in the loaded module");return t.Conversation}function Le(e,t,n=16e3){if(n>=t||e.length===0)return e;let o=t/n,l=new Float32Array(Math.floor(e.length/o));for(let s=0;s<l.length;s++){let c=Math.floor(s*o),a=Math.min(e.length,Math.floor((s+1)*o)),p=0;for(let g=c;g<a;g++)p+=e[g];l[s]=a>c?p/(a-c):0}return l}function Re(e){let t=new Int16Array(e.length);for(let n=0;n<e.length;n++){let o=Math.max(-1,Math.min(1,e[n]));t[n]=o<0?o*32768:o*32767}return t}var yt=`
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.wanted = options.processorOptions.frameSamples
    this.buffer = new Float32Array(this.wanted)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true

    let read = 0
    while (read < channel.length) {
      const room = this.wanted - this.filled
      const take = Math.min(room, channel.length - read)

      this.buffer.set(channel.subarray(read, read + take), this.filled)
      this.filled += take
      read += take

      if (this.filled === this.wanted) {
        // A copy, because the buffer is reused for the next slice and the
        // receiving side may still be holding this one.
        this.port.postMessage(this.buffer.slice(0))
        this.filled = 0
      }
    }

    return true
  }
}

registerProcessor('recourse-capture', Capture)
`,wt={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:1};async function Me(e){let t=e.frameMs??20,{context:n,stream:o}=await(e.open??kt)(),l=Math.round(n.sampleRate*t/1e3),s=n.createMediaStreamSource(o),c=URL.createObjectURL(new Blob([yt],{type:"application/javascript"}));try{await n.audioWorklet.addModule(c)}finally{URL.revokeObjectURL(c)}let a=new AudioWorkletNode(n,"recourse-capture",{numberOfInputs:1,numberOfOutputs:0,processorOptions:{frameSamples:l}});return a.port.onmessage=p=>{let g=Le(p.data,n.sampleRate,16e3);e.onFrame(Re(g))},s.connect(a),{async stop(){a.port.onmessage=null,s.disconnect(),a.disconnect();for(let p of o.getTracks())p.stop();await n.close()}}}async function kt(){let e=await navigator.mediaDevices.getUserMedia({audio:wt});return{context:new AudioContext,stream:e}}function Ne(e){let t=e.cushionSeconds??.05,n=0;return{get endsAt(){return n},get playing(){return n>e.now()},push(o){if(o.length===0)return;let l=e.now(),s=n>l?n:l+t;e.play(o,s),n=s+o.length/e.sampleRate},clear(){n=0}}}function De(e){let t="idle",n=null,o=null,l=null,s=null,c=0,a=m=>{t!==m&&(t=m,e.onStateChange?.(m))},p=m=>{a("failed"),e.onError?.(m)};async function g(){let m=o,k=l,L=n;o=null,l=null,s=null,n=null;try{L?.close()}catch{}await m?.stop().catch(()=>{}),k?.stop(),await k?.close().catch(()=>{})}async function u(){if(t==="connecting"||t==="live")return;let m=++c;a("connecting");let k;try{k=(e.connect??St)(Et(e.endpoint))}catch{m===c&&p("Could not reach the server to start the call.");return}k.binaryType="arraybuffer",n=k,k.onopen=()=>{if(m!==c){k.close();return}k.send(JSON.stringify({type:"hello",sampleRate:16e3,conversationId:e.conversationId()})),b(m,k)},k.onmessage=L=>{if(m===c){if(typeof L.data=="string"){let S;try{S=JSON.parse(L.data)}catch{return}S.type==="transcript"&&S.text&&S.role&&e.onTranscript?.({role:S.role,text:S.text}),S.type==="interrupted"&&(l?.stop(),s?.clear()),S.type==="error"&&e.onError?.(S.message??"Something went wrong.");return}L.data instanceof ArrayBuffer&&x(m,L.data)}},k.onerror=()=>{m===c&&(g(),p("The call was cut off."))},k.onclose=()=>{m===c&&(g(),(t==="live"||t==="connecting")&&a("ended"))}}async function b(m,k){try{if(l=(e.audio??At)(),s=Ne({now:l.now,play:l.play,sampleRate:l.sampleRate}),o=await(e.microphone??Me)({onFrame:L=>{m!==c||!Ct(k)||k.send(L)}}),m!==c){await g();return}a("live")}catch{if(m!==c)return;await g(),p("Could not use your microphone. It may be blocked for this site.")}}async function x(m,k){try{let L=await l?.decode(k);if(m!==c||!L)return;s?.push(L)}catch{}}async function v(){c++,await g(),a(t==="failed"?"failed":"ended")}return{get state(){return t},start:u,stop:v,async toggle(){t==="connecting"||t==="live"?await v():await u()}}}function Ct(e){return e.readyState===1||e.readyState==="open"}function Et(e){if(/^wss?:\/\//i.test(e))return e;let t=new URL(e,location.href);return t.protocol=t.protocol==="https:"?"wss:":"ws:",t.toString()}function St(e){return new WebSocket(e)}function At(){let e=new AudioContext,t=[];return{sampleRate:e.sampleRate,now:()=>e.currentTime,decode:async n=>(await e.decodeAudioData(n)).getChannelData(0),play:(n,o)=>{let l=e.createBuffer(1,n.length,e.sampleRate);l.getChannelData(0).set(n);let s=e.createBufferSource();s.buffer=l,s.connect(e.destination),s.onended=()=>{t=t.filter(c=>c!==s)},s.start(o),t.push(s)},stop:()=>{for(let n of t)try{n.stop()}catch{}t=[]},close:()=>e.close()}}var Ie=`
:host {
  --rc-accent: #2563eb;
  --rc-accent-ink: #ffffff;
  --rc-bg: #ffffff;
  --rc-panel: #ffffff;
  --rc-ink: #111827;
  --rc-muted: #6b7280;
  --rc-line: #e5e7eb;
  --rc-bubble: #f3f4f6;
  --rc-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
  --rc-radius: 16px;
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--rc-ink);
}

:host([data-theme="dark"]) {
  --rc-bg: #0b0f17;
  --rc-panel: #111827;
  --rc-ink: #f3f4f6;
  --rc-muted: #9ca3af;
  --rc-line: #1f2937;
  --rc-bubble: #1f2937;
  --rc-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

*, *::before, *::after { box-sizing: border-box; }

.launcher {
  position: fixed;
  bottom: 20px;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: var(--rc-accent);
  color: var(--rc-accent-ink);
  box-shadow: var(--rc-shadow);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 0.15s ease, opacity 0.15s ease;
  z-index: 2147483000;
}
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible { outline: 3px solid var(--rc-accent); outline-offset: 3px; }
.launcher svg { width: 26px; height: 26px; }

.panel {
  position: fixed;
  bottom: 88px;
  width: min(400px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 120px));
  background: var(--rc-panel);
  border: 1px solid var(--rc-line);
  border-radius: var(--rc-radius);
  box-shadow: var(--rc-shadow);
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
  border-bottom: 1px solid var(--rc-line);
  background: var(--rc-panel);
}
.header h2 { margin: 0; font-size: 15px; font-weight: 600; }
.header p { margin: 2px 0 0; font-size: 12.5px; color: var(--rc-muted); }
.header .grow { flex: 1; min-width: 0; }
.header h2, .header p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.icon-button {
  border: 0;
  background: transparent;
  color: var(--rc-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: grid;
  place-items: center;
}
.icon-button:hover { background: var(--rc-bubble); color: var(--rc-ink); }
.icon-button:focus-visible { outline: 2px solid var(--rc-accent); outline-offset: 1px; }
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
  background: var(--rc-bubble);
  overflow-wrap: anywhere;
}
.msg[data-role="user"] .bubble {
  background: var(--rc-accent);
  color: var(--rc-accent-ink);
  border-bottom-right-radius: 4px;
}
.msg[data-role="assistant"] .bubble { border-bottom-left-radius: 4px; }

.bubble p { margin: 0 0 8px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble ul, .bubble ol { margin: 0 0 8px; padding-inline-start: 20px; }
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
  color: var(--rc-muted);
  border: 1px solid var(--rc-line);
  border-radius: 999px;
  padding: 3px 9px;
  text-decoration: none;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sources a:hover { color: var(--rc-ink); border-color: var(--rc-muted); }

.suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 12px; }
.suggestions button {
  font: inherit;
  font-size: 13px;
  color: var(--rc-ink);
  background: var(--rc-panel);
  border: 1px solid var(--rc-line);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
}
.suggestions button:hover { border-color: var(--rc-accent); color: var(--rc-accent); }
.suggestions button:focus-visible { outline: 2px solid var(--rc-accent); outline-offset: 1px; }

.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--rc-line);
}
.composer textarea {
  flex: 1;
  font: inherit;
  color: var(--rc-ink);
  background: var(--rc-bg);
  border: 1px solid var(--rc-line);
  border-radius: 12px;
  padding: 9px 12px;
  resize: none;
  max-height: 120px;
  min-height: 40px;
}
.composer textarea:focus { outline: 2px solid var(--rc-accent); outline-offset: -1px; }
.composer button[type="submit"] {
  border: 0;
  border-radius: 12px;
  width: 40px;
  height: 40px;
  background: var(--rc-accent);
  color: var(--rc-accent-ink);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: none;
}
.composer button[type="submit"]:disabled { opacity: 0.45; cursor: default; }
.composer button.attach {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  align-self: flex-end;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--rc-muted);
  cursor: pointer;
}
.composer button.attach:hover { background: var(--rc-subtle); color: var(--rc-text); }
.composer button.attach svg { width: 17px; height: 17px; }
.composer button.mic,
.composer button.call {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  align-self: flex-end;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--rc-muted);
  cursor: pointer;
}
.composer button.mic:hover,
.composer button.call:hover { background: var(--rc-subtle); color: var(--rc-text); }
.composer button.mic svg,
.composer button.call svg { width: 17px; height: 17px; }
.composer button.mic[data-recording="true"] {
  color: #fff;
  background: #d33;
  animation: hd-pulse 1.4s ease-in-out infinite;
}
@keyframes hd-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(221, 51, 51, 0.55); }
  50% { box-shadow: 0 0 0 6px rgba(221, 51, 51, 0); }
}
/* Connecting is a wait with no progress to show, so the pulse is the only
   signal that the press was heard. Live is steady, because a call that is up
   does not need to keep announcing itself. */
.composer button.call[data-state="connecting"] {
  color: var(--rc-text);
  animation: hd-pulse 1.4s ease-in-out infinite;
}
.composer button.call[data-state="live"] {
  color: #fff;
  background: #d33;
}
@media (prefers-reduced-motion: reduce) {
  .composer button.mic[data-recording="true"],
  .composer button.call[data-state="connecting"] { animation: none; }
}
.tray {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
}
.tray .chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  padding: 4px 4px 4px 9px;
  border: 1px solid var(--rc-border);
  border-radius: 999px;
  background: var(--rc-subtle);
  font-size: 12px;
  color: var(--rc-text);
}
.tray .chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tray .chip button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--rc-muted);
  cursor: pointer;
}
.tray .chip button:hover { background: var(--rc-border); color: var(--rc-text); }
.tray .chip svg { width: 11px; height: 11px; }
.attached {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
.attached img {
  max-width: 160px;
  max-height: 160px;
  border-radius: 10px;
  border: 1px solid var(--rc-border);
}
.attached .chip {
  padding: 4px 9px;
  border: 1px solid var(--rc-border);
  border-radius: 999px;
  background: var(--rc-subtle);
  font-size: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel[data-dropping="true"] { outline: 2px dashed var(--rc-accent); outline-offset: -4px; }
.composer button svg { width: 18px; height: 18px; }

.typing { display: inline-flex; gap: 4px; padding: 3px 0; }
.typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rc-muted);
  animation: hd-blink 1.2s infinite ease-in-out;
}
.typing i:nth-child(2) { animation-delay: 0.15s; }
.typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes hd-blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }

.feedback { display: flex; gap: 2px; margin-top: 2px; }
.feedback .icon-button { padding: 4px; opacity: 0.55; }
.feedback .icon-button:hover { opacity: 1; }
.feedback .icon-button svg { width: 14px; height: 14px; }
.feedback .icon-button[aria-pressed="true"] { opacity: 1; color: var(--rc-accent); background: none; }

.working {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  opacity: 0.75;
  font-style: italic;
}
.working::before {
  content: '';
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: recourse-spin 0.7s linear infinite;
  flex: none;
}
@keyframes recourse-spin {
  to { transform: rotate(360deg); }
}
/* Somebody who asked for less motion gets the dot without the spin. */
@media (prefers-reduced-motion: reduce) {
  .working::before { animation: none; }
}
.notice {
  align-self: center;
  font-size: 12.5px;
  color: var(--rc-muted);
  background: var(--rc-bubble);
  border-radius: 999px;
  padding: 5px 12px;
  max-width: 92%;
  text-align: center;
}

/* Inline components the agent can put in the conversation. */
.ui-card {
  border: 1px solid var(--rc-line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--rc-panel);
  max-width: 92%;
}
.ui-card-image { display: block; width: 100%; height: auto; max-height: 160px; object-fit: cover; }
.ui-card-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.ui-card h3 { margin: 0; font-size: 14.5px; font-weight: 620; }
.ui-muted { color: var(--rc-muted); font-size: 13px; margin: 0; }

.ui-fields { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 4px 0 0; font-size: 13px; }
.ui-fields dt { color: var(--rc-muted); }
.ui-fields dd { margin: 0; overflow-wrap: anywhere; }

.ui-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.ui-button {
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  border: 1px solid var(--rc-line);
  border-radius: 9px;
  padding: 7px 13px;
  background: var(--rc-panel);
  color: var(--rc-ink);
  text-decoration: none;
  cursor: pointer;
  display: inline-block;
}
.ui-button:hover { border-color: var(--rc-accent); color: var(--rc-accent); }
.ui-button:focus-visible { outline: 2px solid var(--rc-accent); outline-offset: 1px; }

.ui-table-wrap { overflow-x: auto; max-width: 100%; border: 1px solid var(--rc-line); border-radius: 10px; }
.ui-table { border-collapse: collapse; font-size: 13px; width: 100%; }
.ui-table th, .ui-table td { text-align: start; padding: 7px 10px; white-space: nowrap; }
.ui-table th { color: var(--rc-muted); font-weight: 560; border-bottom: 1px solid var(--rc-line); }
.ui-table tbody tr + tr td { border-top: 1px solid var(--rc-line); }

.ui-list { display: flex; flex-direction: column; gap: 6px; max-width: 92%; }
.ui-list-item {
  font: inherit;
  text-align: start;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--rc-line);
  border-radius: 10px;
  padding: 9px 12px;
  background: var(--rc-panel);
  color: var(--rc-ink);
  text-decoration: none;
  cursor: pointer;
}
.ui-list-item:hover { border-color: var(--rc-accent); }
.ui-list-title { font-size: 13.5px; font-weight: 560; }

.ui-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--rc-line);
  border-radius: 12px;
  padding: 14px;
  max-width: 92%;
  background: var(--rc-panel);
}
.ui-form h3 { margin: 0; font-size: 14.5px; font-weight: 620; }
.ui-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--rc-muted); }
.ui-field input[type="text"],
.ui-field input[type="number"],
.ui-field select {
  font: inherit;
  font-size: 14px;
  color: var(--rc-ink);
  background: var(--rc-bg);
  border: 1px solid var(--rc-line);
  border-radius: 9px;
  padding: 8px 10px;
}
.ui-field input:focus, .ui-field select:focus { outline: 2px solid var(--rc-accent); outline-offset: -1px; }
.ui-field input[type="checkbox"] { width: 16px; height: 16px; }

/* The nudge above the launcher, before anyone has opened the panel. */
.invite {
  position: fixed;
  bottom: 88px;
  max-width: min(280px, calc(100vw - 40px));
  background: var(--rc-panel);
  color: var(--rc-ink);
  border: 1px solid var(--rc-line);
  border-radius: 14px;
  box-shadow: var(--rc-shadow);
  padding: 12px 34px 12px 14px;
  font-size: 14px;
  line-height: 1.45;
  cursor: pointer;
  z-index: 2147482999;
  animation: hd-rise 0.28s ease both;
}
.invite-dismiss {
  position: absolute;
  top: 6px;
  right: 6px;
  border: 0;
  background: transparent;
  color: var(--rc-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  line-height: 0;
}
.invite-dismiss:hover { background: var(--rc-bubble); color: var(--rc-ink); }
.invite-dismiss svg { width: 13px; height: 13px; }

@keyframes hd-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.footer {
  padding: 0 16px 10px;
  font-size: 11px;
  color: var(--rc-muted);
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
  .panel, .launcher, .typing i, .invite { transition: none; animation: none; }
}
`;var Oe={title:"Ask us anything",open:"Open the support chat",close:"Close the support chat",placeholder:"Type your question",send:"Send",inputLabel:"Your question",attach:"Attach a file",removeFile:"Remove {name}",dictate:"Dictate your question",stopDictating:"Stop dictating",call:"Talk to us",endCall:"End the call",calling:"Connecting",callStarted:"Call started",callEnded:"Call ended",working:"Checking {name}",helpful:"This helped",notHelpful:"This did not help",thanks:"Thanks, that helps us improve.",copy:"Copy this answer",copied:"Copied",deleteConversation:"Delete this conversation",deleteConfirm:"Delete this conversation? It cannot be brought back.",offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status}).",submit:"Send",submitted:"Thanks, sending that now.",dismiss:"Dismiss"};function Fe(e){if(!e)return Oe;let t={...Oe};for(let[n,o]of Object.entries(e))typeof o=="string"&&o.trim().length>0&&(t[n]=o);return t}function ue(e,t){return e.replace(/\{(\w+)\}/g,(n,o)=>o in t?String(t[o]):n)}var Tt=["recourse_q","rc_q"];function Lt(e={}){let t=e.params??Tt,n;try{n=new URL(e.href??window.location.href)}catch{return null}let o=null;for(let l of t){let s=n.searchParams.get(l);if(s&&s.trim()){o=s.trim().slice(0,1e3);break}}if(o===null)return null;if(e.strip!==!1){for(let l of t)n.searchParams.delete(l);try{window.history.replaceState(window.history.state,"",n.toString())}catch{}}return o}function He(e,t={}){let n=Lt(t);return n===null?null:(e.open(),e.ask(n),n)}function Ue(e){return`recourse:transcript:${e}`}function Pe(e){return`recourse:invite:${e}`}var H={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z",clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",mic:"M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",phone:"M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",hangUp:"M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"},Rt=["image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/markdown","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];function We(e){if(!e.endpoint)throw new Error("recourse: an `endpoint` is required");let t=Fe(e.strings),n=!!e.target,o=document.createElement("div");o.setAttribute("data-recourse",""),n&&o.setAttribute("data-inline","true"),o.style.cssText=n?"display:block;width:100%;height:100%":"";let l=o.attachShadow({mode:"open"}),s=document.createElement("style");s.textContent=Ie,l.appendChild(s),e.accent&&o.style.setProperty("--rc-accent",e.accent),Mt(o,e.theme??"auto");let c=e.position==="bottom-left"?"pos-left":"pos-right",a={messages:e.persist===!1?[]:Nt(e.endpoint),busy:!1,controller:null,conversationId:`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,suggestions:e.suggestions??[],staged:[]},p={...e.actions},g=[],u=new Map;function b(r,i){for(let d of u.get(r)??[])try{d(i)}catch(f){console.error(`[recourse] listener for "${r}" threw`,f)}}let x=document.createElement("button");x.className=`launcher ${c}`,x.type="button",x.setAttribute("aria-label",t.open),x.setAttribute("aria-expanded","false"),x.appendChild(M(H.chat,!0));let v=document.createElement("div");v.className=`panel ${c}`,v.setAttribute("role","dialog"),v.setAttribute("aria-modal","false"),v.setAttribute("aria-label",e.title??t.title),v.dataset.open=String(n||e.open===!0);let m=document.createElement("div");m.className="header";let k=document.createElement("div");k.className="grow";let L=document.createElement("h2");if(L.textContent=e.title??t.title,k.appendChild(L),e.subtitle){let r=document.createElement("p");r.textContent=e.subtitle,k.appendChild(r)}m.appendChild(k);let S=document.createElement("button");S.className="icon-button",S.type="button",S.setAttribute("aria-label",t.deleteConversation),S.appendChild(M("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z",!1)),e.allowDelete&&m.appendChild(S);let _=document.createElement("button");_.className="icon-button",_.type="button",_.setAttribute("aria-label",t.close),_.appendChild(M(H.close,!1)),n||m.appendChild(_);let A=document.createElement("div");A.className="log",A.setAttribute("role","log"),A.setAttribute("aria-live","polite"),A.setAttribute("aria-relevant","additions text"),A.setAttribute("aria-live","polite"),A.setAttribute("aria-relevant","additions text");let X=document.createElement("div");X.className="suggestions";let z=document.createElement("div");z.className="error",z.hidden=!0,z.setAttribute("role","alert");let G=document.createElement("form");G.className="composer";let w=document.createElement("textarea");w.setAttribute("dir","auto"),w.rows=1,w.placeholder=t.placeholder,w.setAttribute("aria-label",t.inputLabel);let U=document.createElement("button");U.type="submit",U.setAttribute("aria-label",t.send),U.appendChild(M(H.send,!0));let N=e.attachments?{maxBytes:(typeof e.attachments=="object"?e.attachments.maxBytes:void 0)??10*1024*1024,maxCount:(typeof e.attachments=="object"?e.attachments.maxCount:void 0)??4,accept:(typeof e.attachments=="object"?e.attachments.accept:void 0)??Rt}:null,V=document.createElement("div");V.className="tray",V.hidden=!0;let D=document.createElement("input");D.type="file",D.multiple=!0,D.hidden=!0,D.tabIndex=-1;let q=document.createElement("button");q.type="button",q.className="attach",q.setAttribute("aria-label",t.attach),q.appendChild(M(H.clip,!1));let pe=e.dictation?typeof e.dictation=="object"?e.dictation:{}:null,W=document.createElement("button");W.type="button",W.className="mic",W.setAttribute("aria-label",t.dictate),W.appendChild(M(H.mic,!1));let F=null;N&&(D.accept=N.accept.join(",")),pe&&(F=Ae({...pe,onStateChange:r=>{W.dataset.recording=String(r),W.setAttribute("aria-label",r?t.stopDictating:t.dictate),r||(w.dataset.interim="")},onInterim:r=>{w.value=`${w.dataset.beforeDictation??""}${r}`},onFinal:r=>{let i=w.dataset.beforeDictation??"",d=i&&!i.endsWith(" ")?`${i} ${r}`:`${i}${r}`;w.value=d,w.dataset.beforeDictation=d},onError:r=>B(r)}),F&&(W.addEventListener("click",()=>{F&&(F.recording||(w.dataset.beforeDictation=w.value),F.toggle(),w.focus())}),w.addEventListener("keydown",r=>{r.key==="Escape"&&F?.recording&&(r.preventDefault(),w.value=w.dataset.beforeDictation??"",F.cancel())})));let me=typeof e.call=="string"?e.call:e.call?e.call.endpoint:null,fe=typeof e.call=="object"?e.call.load:void 0,je=typeof e.call=="object"?e.call.transport:void 0,P=document.createElement("button");P.type="button",P.className="call",P.setAttribute("aria-label",t.call),P.appendChild(M(H.phone,!1));let te=null;if(me){let r={endpoint:me,conversationId:()=>a.conversationId,onStateChange:i=>$e(i),onTranscript:({role:i,text:d})=>{J({role:i==="visitor"?"user":"assistant",content:d})},onError:i=>B(i)};te=je==="hosted"?De(r):Te({...r,...fe?{load:fe}:{}}),P.addEventListener("click",()=>{te?.toggle()})}function $e(r){P.dataset.state=r;let i=r==="live"||r==="connecting";P.setAttribute("aria-label",i?t.endCall:t.call),P.replaceChildren(M(i?H.hangUp:H.phone,!1)),r==="live"&&Z(t.callStarted),r==="ended"&&Z(t.callEnded)}let _e=F?[W]:[],Ve=te?[P]:[];G.append(...N?[q]:[],w,..._e,...Ve,U),v.append(m,A,X,z,V,G),N&&v.appendChild(D),n?l.append(v):l.append(x,v),(e.target??document.body).appendChild(o),N&&(q.addEventListener("click",()=>D.click()),D.addEventListener("change",()=>{D.files&&ne(D.files),D.value=""}),v.addEventListener("dragover",r=>{r.dataTransfer?.types.includes("Files")&&(r.preventDefault(),v.dataset.dropping="true")}),v.addEventListener("dragleave",()=>{delete v.dataset.dropping}),v.addEventListener("drop",r=>{r.dataTransfer?.files.length&&(r.preventDefault(),delete v.dataset.dropping,ne(r.dataTransfer.files))}),w.addEventListener("paste",r=>{let i=Array.from(r.clipboardData?.files??[]);i.length!==0&&(r.preventDefault(),ne(i))}));function K(r){b(r?"open":"close",{}),r&&l.querySelector(".invite")?.remove(),v.dataset.open=String(r),x.setAttribute("aria-expanded",String(r)),x.setAttribute("aria-label",r?t.close:t.open),r?w.focus():x.focus()}function B(r){z.textContent=r,z.hidden=!1}async function ne(r){if(N){z.hidden=!0;for(let i of Array.from(r)){if(a.staged.length>=N.maxCount){B(`You can attach ${N.maxCount} files at a time.`);break}let d=(i.type||"").split(";")[0]?.trim().toLowerCase()??"";if(!N.accept.includes(d)){B(`${i.name} is not a file type we can read.`);continue}if(i.size>N.maxBytes){B(`${i.name} is larger than ${Math.round(N.maxBytes/1024/1024)}MB.`);continue}let f;try{f=await Dt(i)}catch{B(`${i.name} could not be read.`);continue}a.staged.push({name:i.name,mimeType:d,dataUrl:f,bytes:i.size})}re()}}function re(){V.replaceChildren(),V.hidden=a.staged.length===0;for(let[r,i]of a.staged.entries()){let d=document.createElement("span");d.className="chip";let f=document.createElement("span");f.textContent=i.name,d.appendChild(f);let h=document.createElement("button");h.type="button",h.setAttribute("aria-label",ue(t.removeFile,{name:i.name})),h.appendChild(M(H.close,!1)),h.addEventListener("click",()=>{a.staged.splice(r,1),re(),w.focus()}),d.appendChild(h),V.appendChild(d)}}function j(){A.scrollTop=A.scrollHeight}function qe(r,i){let d=new Set;for(let I of i.matchAll(/\[(\d{1,2})\]/g))d.add(Number.parseInt(I[1],10)-1);let f=d.size>0?r.filter((I,E)=>d.has(E)):r,h=new Set,y=[];for(let I of f){let E=`${I.url??""}|${I.title}|${I.section??""}`;h.has(E)||(h.add(E),y.push(I))}return y}function ge(r,i){if(i.length===0)return;let d=document.createElement("div");d.className="sources";for(let f of i.slice(0,4)){let h=f.section?`${f.title} \xB7 ${f.section}`:f.title,y=document.createElement(f.url?"a":"span");y.textContent=h,f.url&&y instanceof HTMLAnchorElement&&(y.href=f.url,y.target="_blank",y.rel="noopener noreferrer"),d.appendChild(y)}r.appendChild(d)}function J(r){let i=document.createElement("div");i.className="msg",i.dataset.role=r.role;let d=document.createElement("div");return d.className="bubble",d.setAttribute("dir","auto"),r.role==="user"?d.textContent=r.content:d.appendChild(Y(r.content)),r.role==="user"&&!r.content&&r.attachments?.length?d.remove():i.appendChild(d),r.attachments?.length&&et(i,r.attachments),r.sources&&ge(i,r.sources),A.appendChild(i),j(),{bubble:d,wrapper:i}}function oe(){if(X.replaceChildren(),a.suggestions.length!==0)for(let r of a.suggestions.slice(0,4)){let i=document.createElement("button");i.type="button",i.textContent=r,i.addEventListener("click",()=>{Q(r)}),X.appendChild(i)}}function he(){A.replaceChildren(),e.greeting&&J({role:"assistant",content:e.greeting});for(let r of a.messages)J(r);oe()}function Ke(r){if(e.copy===!1||typeof navigator>"u"||!navigator.clipboard?.writeText)return;let i=document.createElement("button");return i.type="button",i.className="icon-button",i.setAttribute("aria-label",t.copy),i.appendChild(M("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z",!0)),i.addEventListener("click",()=>{navigator.clipboard.writeText(r).then(()=>{i.setAttribute("aria-label",t.copied),i.setAttribute("data-copied","true"),setTimeout(()=>{i.setAttribute("aria-label",t.copy),i.removeAttribute("data-copied")},1600)}).catch(()=>{})}),i}function be(){a.messages=[],a.suggestions=e.suggestions??[],a.conversationId=`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,ze(e.endpoint,[],e.persist!==!1),he()}async function ve(){let r=a.conversationId;be();try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deleteConversation:r})})}catch{}}function Ge(r,i,d=""){let f=Ke(d);if(e.feedback===!1){if(!f)return;let y=document.createElement("div");y.className="feedback",y.appendChild(f),r.appendChild(y);return}let h=document.createElement("div");h.className="feedback";for(let[y,I,E]of[["positive",t.helpful,"M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],["negative",t.notHelpful,"M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]]){let O=document.createElement("button");O.type="button",O.className="icon-button",O.setAttribute("aria-label",I),O.appendChild(M(E,!0)),O.addEventListener("click",()=>{O.setAttribute("aria-pressed","true"),h.querySelectorAll("button").forEach($=>{$!==O&&$.removeAttribute("aria-pressed")}),Je(i,y)}),h.appendChild(O)}f&&h.appendChild(f),r.appendChild(h)}async function Je(r,i){try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feedback:{conversationId:a.conversationId,messageIndex:r,value:i}})})}catch{}}async function Q(r){let i=r.trim();if(!i&&a.staged.length===0||a.busy)return;z.hidden=!0,a.busy=!0,U.disabled=!0,F?.recording&&F.cancel(),w.dataset.beforeDictation="";let d=a.staged;a.staged=[],re();let f={role:"user",content:i};d.length>0&&(f.attachments=d),a.messages.push(f),J(f),b("message",{text:i}),a.suggestions=[],oe(),a.controller=new AbortController,await ie(void 0,d),a.busy=!1,U.disabled=!1,a.controller=null,j(),w.focus()}async function ie(r,i){let{bubble:d,wrapper:f}=J({role:"assistant",content:""});A.setAttribute("aria-busy","true");let h=document.createElement("span");h.className="typing",h.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),d.appendChild(h);let y=null,I=T=>{if(!E.content){if(!T){y?.remove(),y=null,d.contains(h)||d.appendChild(h);return}h.remove(),y??(y=document.createElement("div")),y.className="working",y.textContent=ue(t.working,{name:T}),d.contains(y)||d.appendChild(y),j()}},E={role:"assistant",content:""},O=[],$=[];if(await Se(e.endpoint,{messages:a.messages,conversationId:a.conversationId,userId:e.userId,userHash:e.userHash,contact:e.contact,actionResults:r,...i&&i.length>0?{attachments:i}:{}},{onSources:T=>{O=T},onDelta:T=>{h.remove(),y?.remove(),y=null,E.content+=T,d.replaceChildren(Y(E.content)),j()},onError:T=>{h.remove(),y?.remove(),y=null,B(T),b("error",{message:T})},onFrame:T=>Xe(T,$,I)},a.controller?.signal,t).finally(()=>{h.remove(),A.setAttribute("aria-busy","false")}),$.length>0&&!r){f.remove();let T=$.find(se=>se.payload?.form);if(T){ae={name:T.name,input:T.input};let se=Ce(T.payload?.form,xe),ee=document.createElement("div");ee.className="msg",ee.dataset.role="assistant",ee.appendChild(se),A.appendChild(ee),j();return}let nt=await Ze($);await ie(nt);return}E.content.trim()?(E.sources=qe(O,E.content),a.messages.push(E),ge(f,E.sources),Ge(f,a.messages.length-1,E.content),ze(e.endpoint,a.messages,e.persist!==!1),b("response",{text:E.content,sources:E.sources})):f.remove(),oe()}function Ye(r){return r.replace(/[_-]+/g," ").trim()}function Xe(r,i,d=()=>{}){if(r.type==="client-action")i.push({id:r.id,name:r.name,input:r.input,payload:r.payload});else if(r.type==="suggestions")a.suggestions=r.items;else if(r.type==="action")b("action",{name:r.name,status:r.status}),d(r.status==="running"?r.summary??Ye(r.name):null);else if(r.type==="captured")b("captured",{kind:r.kind,name:r.name,values:r.values});else if(r.type==="notice")Z(r.message);else if(r.type==="handoff")b("handoff",{ticketId:r.ticketId,message:r.message}),Z(r.message);else if(r.type==="ui"){let f=Ee({kind:r.kind,id:r.id,data:r.data},xe);if(f){let h=document.createElement("div");h.className="msg",h.dataset.role="assistant",h.appendChild(f),A.appendChild(h),j()}}}let xe={submit:r=>{Q(r)},respond:r=>{Qe(r)},run:async(r,i)=>{let d=p[r];if(!d)throw new Error("That is not available here");return d(i)}},ae=null;async function Qe(r){let i=ae;ae=null,!(!i||a.busy)&&(a.busy=!0,U.disabled=!0,a.controller=new AbortController,await ie([{name:i.name,input:i.input,output:r}]),a.busy=!1,U.disabled=!1,a.controller=null)}async function Ze(r){return Promise.all(r.map(async i=>{let d=p[i.name];if(!d)return{name:i.name,input:i.input,output:{error:"no handler registered on this page"}};try{return{name:i.name,input:i.input,output:await d(i.input)}}catch(f){return{name:i.name,input:i.input,output:{error:f instanceof Error?f.message:String(f)}}}}))}function et(r,i){let d=document.createElement("div");d.className="attached";for(let f of i){if(f.mimeType.startsWith("image/")){let y=document.createElement("img");y.src=f.dataUrl,y.alt=f.name,d.appendChild(y);continue}let h=document.createElement("span");h.className="chip",h.textContent=f.name,d.appendChild(h)}r.appendChild(d)}function Z(r){let i=document.createElement("div");i.className="notice",i.textContent=r,A.appendChild(i),j()}function tt(){if(n||!e.invite||v.dataset.open==="true")return;try{if(sessionStorage.getItem(Pe(e.endpoint)))return}catch{}let r=document.createElement("div");r.className=`invite ${c}`,r.setAttribute("role","button"),r.tabIndex=0,r.appendChild(document.createTextNode(e.invite));let i=document.createElement("button");i.type="button",i.className="invite-dismiss",i.setAttribute("aria-label",t.dismiss),i.appendChild(M(H.close,!1));let d=()=>{r.remove();try{sessionStorage.setItem(Pe(e.endpoint),"1")}catch{}};i.addEventListener("click",h=>{h.stopPropagation(),d()});let f=()=>{d(),K(!0)};r.addEventListener("click",f),r.addEventListener("keydown",h=>{(h.key==="Enter"||h.key===" ")&&(h.preventDefault(),f())}),r.appendChild(i),l.appendChild(r)}if(e.invite&&!n){let r=e.inviteDelay??4e3,i=setTimeout(tt,r);g.push(i)}x.addEventListener("click",()=>K(v.dataset.open!=="true")),_.addEventListener("click",()=>K(!1)),S.addEventListener("click",()=>{typeof window.confirm=="function"&&!window.confirm(t.deleteConfirm)||ve()}),G.addEventListener("submit",r=>{r.preventDefault();let i=w.value;w.value="",w.style.height="auto",Q(i)}),w.addEventListener("input",()=>{w.style.height="auto",w.style.height=`${w.scrollHeight}px`}),w.addEventListener("keydown",r=>{r.key==="Enter"&&!r.shiftKey&&(r.preventDefault(),G.requestSubmit())}),l.addEventListener("keydown",r=>{r.key==="Escape"&&!n&&K(!1)}),he();let ye={open:()=>K(!0),close:()=>K(!1),ask:Q,on(r,i){let d=u.get(r)??new Set;return d.add(i),u.set(r,d),()=>d.delete(i)},handle(r,i){p[r]=i},clear(){be()},forget:()=>ve(),destroy(){a.controller?.abort();for(let r of g)clearTimeout(r);o.remove()},element:o};return e.deepLink!==!1&&He(ye),ye}function Mt(e,t){if(t!=="auto"){e.setAttribute("data-theme",t);return}let n=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>e.setAttribute("data-theme",n.matches?"dark":"light");o(),n.addEventListener("change",o)}function M(e,t){let n=document.createElementNS("http://www.w3.org/2000/svg","svg");n.setAttribute("viewBox","0 0 24 24"),n.setAttribute("aria-hidden","true"),n.setAttribute("fill",t?"currentColor":"none"),n.setAttribute("stroke",t?"none":"currentColor"),n.setAttribute("stroke-width","2"),n.setAttribute("stroke-linecap","round");let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",e),n.appendChild(o),n}function Nt(e){try{let t=sessionStorage.getItem(Ue(e));return t?JSON.parse(t):[]}catch{return[]}}function ze(e,t,n){if(n)try{sessionStorage.setItem(Ue(e),JSON.stringify(t.slice(-20)))}catch{}}function Dt(e){return new Promise((t,n)=>{let o=new FileReader;o.onload=()=>t(String(o.result)),o.onerror=()=>n(new Error("unreadable")),o.readAsDataURL(e)})}function It(){let t=document.currentScript?.dataset??{},n=t.endpoint??window.recourseConfig?.endpoint;if(!n)return console.warn("[recourse] no data-endpoint on the script tag, widget not mounted"),null;let o=t.target?document.querySelector(t.target):null;return{endpoint:n,userId:t.userId,userHash:t.userHash,feedback:t.feedback!=="false",invite:t.invite,inviteDelay:t.inviteDelay?Number(t.inviteDelay):void 0,title:t.title,subtitle:t.subtitle,greeting:t.greeting,accent:t.accent,suggestions:t.suggestions?.split("|").map(l=>l.trim()).filter(Boolean),position:t.position==="bottom-left"?"bottom-left":"bottom-right",theme:t.theme==="dark"||t.theme==="light"?t.theme:"auto",open:t.open==="true",persist:t.persist!=="false",deepLink:t.deepLink!=="false",...Ot(t.attachments),...t.dictation==="true"?{dictation:{...t.dictationLang?{lang:t.dictationLang}:{},...t.dictationCloud==="true"?{allowCloudFallback:!0}:{}}}:{},...t.call?{call:t.callTransport==="hosted"?{endpoint:t.call,transport:"hosted"}:t.call}:{},copy:t.copy!=="false",allowDelete:t.delete==="true",...window.recourseConfig,...o?{target:o}:{}}}function Ot(e){if(!e||e==="false")return{};if(e==="true")return{attachments:!0};let t=Number(e);return Number.isFinite(t)&&t>0?{attachments:{maxBytes:Math.round(t*1024*1024)}}:{}}var Be=It();if(Be){let e=()=>{window.recourse=We(Be)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e()}})();
