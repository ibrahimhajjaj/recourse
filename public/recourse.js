"use strict";(()=>{var ht=/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,bt=/^(https?:|mailto:|\/|#)/i;function ee(e){let t=document.createDocumentFragment();for(let r of vt(e))t.appendChild(xt(r));return t}function vt(e){let t=[],r=null,o=null,s=()=>{r&&r.lines.length>0&&t.push(r),r=null};for(let l of e.split(`
`)){if(/^\s*(```|~~~)/.test(l)){o?(t.push(o),o=null):(s(),o={kind:"code",lines:[]});continue}if(o){o.lines.push(l);continue}if(l.trim()===""){s();continue}let c=/^\s*[-*+]\s+(.*)$/.exec(l),i=/^\s*\d+[.)]\s+(.*)$/.exec(l),p=c?"ul":i?"ol":"p",f=c?.[1]??i?.[1]??l;(!r||r.kind!==p)&&(s(),r={kind:p,lines:[]}),r.lines.push(f)}return o&&t.push(o),s(),t}function xt(e){if(e.kind==="code"){let r=document.createElement("pre"),o=document.createElement("code");return o.textContent=e.lines.join(`
`),r.appendChild(o),r}if(e.kind==="ul"||e.kind==="ol"){let r=document.createElement(e.kind);for(let o of e.lines){let s=document.createElement("li");s.appendChild(Ne(o)),r.appendChild(s)}return r}let t=document.createElement("p");return t.appendChild(Ne(e.lines.join(" "))),t}function Ne(e){let t=document.createDocumentFragment();for(let r of e.split(ht)){if(!r)continue;if(r.startsWith("**")&&r.endsWith("**")){t.appendChild(ge("strong",r.slice(2,-2)));continue}if(r.startsWith("`")&&r.endsWith("`")){t.appendChild(ge("code",r.slice(1,-1)));continue}if(r.startsWith("*")&&r.endsWith("*")&&r.length>2){t.appendChild(ge("em",r.slice(1,-1)));continue}let o=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(r);if(o){let s=o[2];if(bt.test(s)){let l=document.createElement("a");l.textContent=o[1],l.href=s,l.target="_blank",l.rel="noopener noreferrer",t.appendChild(l)}else t.appendChild(document.createTextNode(o[1]));continue}t.appendChild(document.createTextNode(r))}return t}function ge(e,t){let r=document.createElement(e);return r.textContent=t,r}var be=/^(https?:|mailto:|tel:|\/|#)/i;function he(e,t){let r=e.showIf;if(r===void 0)return!0;if(typeof r=="boolean")return r;if(typeof r=="string"){let o=r.startsWith("!"),s=o?r.slice(1):r,[l,c]=s.split("=",2),i=t[(l??"").trim()],p=c===void 0?!!i:String(i)===c.trim();return o?!p:p}return!0}function I(e,t,r){let o=document.createElement(e);return o.textContent=t,r&&(o.className=r),o}function E(e){return typeof e=="string"?e:e==null?"":String(e)}function De(e,t,r){if(!be.test(t))return I("span",e,r);let o=document.createElement("a");return o.textContent=e,o.href=t,o.target="_blank",o.rel="noopener noreferrer",o.className=r,o}var yt=e=>{let t=E(e.label)||"Open",r=E(e.url);if(!r)return null;let o=document.createElement("div");return o.className="ui-actions",o.appendChild(De(t,r,"ui-button")),o};function wt(e,t){let r=E(e.label);if(!r)return null;if(e.url)return De(r,E(e.url),"ui-button");let o=document.createElement("button");return o.type="button",o.className="ui-button",o.textContent=r,e.run?(o.addEventListener("click",async()=>{if(t.run){o.disabled=!0;try{await t.run(E(e.run),e.payload??{}),o.replaceWith(I("span",E(e.done)||"Done","ui-muted"))}catch(s){o.disabled=!1,o.textContent=s instanceof Error?s.message:"That did not work"}}}),o):(o.addEventListener("click",()=>t.submit(E(e.send)||r)),o)}var kt=(e,t)=>{let r=document.createElement("div");if(r.className="ui-card",e.image&&be.test(E(e.image))){let c=document.createElement("img");c.src=E(e.image),c.alt=E(e.title),c.loading="lazy",c.className="ui-card-image",r.appendChild(c)}let o=document.createElement("div");o.className="ui-card-body",e.title&&o.appendChild(I("h3",E(e.title))),e.subtitle&&o.appendChild(I("p",E(e.subtitle),"ui-muted"));let s=(Array.isArray(e.fields)?e.fields:[]).filter(c=>he(c,e));if(s.length>0){let c=document.createElement("dl");c.className="ui-fields";for(let i of s){let p=i;c.appendChild(I("dt",E(p.label))),c.appendChild(I("dd",E(p.value)))}o.appendChild(c)}let l=(Array.isArray(e.actions)?e.actions:[]).filter(c=>he(c,e));if(l.length>0){let c=document.createElement("div");c.className="ui-actions";for(let i of l){let p=wt(i,t);p&&c.appendChild(p)}c.childElementCount>0&&o.appendChild(c)}return r.appendChild(o),r},Ct=e=>{let t=(Array.isArray(e.columns)?e.columns:[]).map(E),r=Array.isArray(e.rows)?e.rows:[];if(t.length===0||r.length===0)return null;let o=document.createElement("div");o.className="ui-table-wrap";let s=document.createElement("table");s.className="ui-table";let l=document.createElement("thead"),c=document.createElement("tr");for(let p of t)c.appendChild(I("th",p));l.appendChild(c),s.appendChild(l);let i=document.createElement("tbody");for(let p of r.slice(0,25)){let f=document.createElement("tr"),u=Array.isArray(p)?p:t.map(b=>p[b]);for(let b of u)f.appendChild(I("td",E(b)));i.appendChild(f)}return s.appendChild(i),o.appendChild(s),o},Et=(e,t)=>{let r=(Array.isArray(e.items)?e.items:[]).filter(s=>he(s,e));if(r.length===0)return null;let o=document.createElement("div");o.className="ui-list";for(let s of r){let l=s,c=E(l.title);if(!c)continue;let i=document.createElement(l.url?"a":"button");i.className="ui-list-item",i instanceof HTMLAnchorElement&&be.test(E(l.url))?(i.href=E(l.url),i.target="_blank",i.rel="noopener noreferrer"):i instanceof HTMLButtonElement&&(i.type="button",i.addEventListener("click",()=>t.submit(E(l.send)||c))),i.appendChild(I("span",c,"ui-list-title")),l.subtitle&&i.appendChild(I("span",E(l.subtitle),"ui-muted")),o.appendChild(i)}return o.childElementCount>0?o:null};function Ie(e,t){let r=document.createElement("form");r.className="ui-form",e.title&&r.appendChild(I("h3",e.title));let o=Array.isArray(e.fields)?e.fields:[],s=[];for(let i of o){let p=i,f=E(p.name);if(!f)continue;let u=document.createElement("label");u.className="ui-field",u.appendChild(I("span",E(p.label)||f));let b;if(Array.isArray(p.options)&&p.options.length>0){let x=document.createElement("select");for(let v of p.options){let m=document.createElement("option");m.value=E(v),m.textContent=E(v),x.appendChild(m)}b=x}else if(p.type==="boolean"){let x=document.createElement("input");x.type="checkbox",b=x}else{let x=document.createElement("input");x.type=p.type==="number"?"number":"text",p.placeholder&&(x.placeholder=E(p.placeholder)),b=x}b.name=f,p.required!==!1&&b instanceof HTMLInputElement&&b.type!=="checkbox"&&(b.required=!0),u.appendChild(b),r.appendChild(u),s.push({name:f,element:b})}let l=document.createElement("button");l.type="submit",l.className="ui-button",l.textContent=e.submitLabel||"Send",r.appendChild(l);let c=!1;return r.addEventListener("submit",i=>{if(i.preventDefault(),c)return;c=!0;let p={};for(let{name:f,element:u}of s)p[f]=u instanceof HTMLInputElement&&u.type==="checkbox"?u.checked:u.value;r.replaceChildren(ee("Thanks, sending that now.")),t.respond(p)}),r}var St={button:yt,card:kt,table:Ct,list:Et};function Oe(e,t){let r=St[e.kind];return r?r(e.data,t):null}var At={offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status})."};async function Fe(e,t,r,o,s=At){let l;try{l=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,messages:t.messages.map(f=>({role:f.role,content:f.content}))}),signal:o})}catch{r.onError?.(s.offline);return}if(!l.ok||!l.body){r.onError?.(l.status===429?s.rateLimited:s.unavailable.replace("{status}",String(l.status)));return}let c=l.body.getReader(),i=new TextDecoder,p="";for(;;){let{done:f,value:u}=await c.read();if(f)break;p+=i.decode(u,{stream:!0});let b=p.split(`

`);p=b.pop()??"";for(let x of b){let v=x.split(`
`).find(w=>w.startsWith("data:"));if(!v)continue;let m;try{m=JSON.parse(v.slice(5).trim())}catch{continue}r.onFrame?.(m),m.type==="sources"?r.onSources?.(m.sources):m.type==="delta"?r.onDelta?.(m.text):m.type==="done"?r.onDone?.():m.type==="error"&&r.onError?.(m.message)}}r.onDone?.()}function Tt(e=globalThis){let t=e;return t.SpeechRecognition??t.webkitSpeechRecognition??null}var Mt={"not-allowed":"I need permission to use the microphone. You can allow it in your browser settings.","service-not-allowed":"Your browser would not let me use speech recognition.","no-speech":"I did not hear anything. Try again?","audio-capture":"I could not find a microphone.",network:"Speech recognition needs a connection and could not reach it.","language-not-supported":"Speech recognition is not available for this language on your device."};function He(e={},t=globalThis){let r=Tt(t);if(!r)return null;let o=r,s=null,l=!1;function c(f){let u=new o;u.continuous=!0,u.interimResults=!0,u.maxAlternatives=1;let b=e.lang??Lt(t);return b&&(u.lang=b),f&&(u.processLocally=!0),u}function i(f){f.onstart=()=>e.onStateChange?.(!0),f.onresult=u=>{let b="";for(let x=u.resultIndex;x<u.results.length;x++){let v=u.results[x];if(!v)continue;let m=v[0]?.transcript??"";v.isFinal?e.onFinal?.(m):b+=m}b&&e.onInterim?.(b)},f.onerror=u=>{let b=e.processLocally!==!1,x=u.error==="language-not-supported"||u.error==="service-not-allowed";if(b&&x&&e.allowCloudFallback&&!l){l=!0,s=null,p(!1);return}u.error!=="aborted"&&e.onError?.(Mt[u.error]??"Speech recognition stopped unexpectedly.")},f.onend=()=>{s=null,e.onStateChange?.(!1)}}function p(f){let u=c(f);i(u),s=u;try{u.start()}catch{s=null,e.onStateChange?.(!1)}}return{get recording(){return s!==null},start(){s||(l=!1,p(e.processLocally!==!1))},stop(){s?.stop()},cancel(){let f=s;s=null,f?.abort(),e.onStateChange?.(!1)},toggle(){s?this.stop():this.start()}}}function Lt(e){return e.document?.documentElement?.lang??""}function Pe(e){let t=e.fetch??globalThis.fetch.bind(globalThis),r=e.load??Nt,o="idle",s=null,l=0,c=u=>{o!==u&&(o=u,e.onStateChange?.(u))},i=u=>{c("failed"),e.onError?.(u)};async function p(){if(o==="connecting"||o==="live")return;let u=++l;c("connecting");let b;try{let v=await t(e.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:e.conversationId()})});if(v.status===429){u===l&&i("Too many calls just now. Try again in a moment.");return}if(!v.ok){u===l&&i("Calling is not available right now.");return}let m=await v.json();if(typeof m.signedUrl!="string"||!m.signedUrl){u===l&&i("Calling is not available right now.");return}b=m.signedUrl}catch{u===l&&i("Could not reach the server to start the call.");return}if(u!==l)return;let x;try{x=await r()}catch{u===l&&i("Could not load the voice connection.");return}if(u===l)try{let v=await x.startSession({signedUrl:b,onConnect:()=>{u===l&&c("live")},onDisconnect:()=>{u===l&&(s=null,c("ended"))},onError:()=>{u===l&&i("The call ended unexpectedly. Your microphone may be blocked.")},onMessage:m=>{let w=typeof m?.message=="string"?m.message.trim():"";w&&e.onTranscript?.({role:m.source==="user"?"visitor":"agent",text:w})}});if(u!==l){await Promise.resolve(v.endSession()).catch(()=>{});return}s=v}catch{u===l&&i("Could not start the call. Your microphone may be blocked.")}}async function f(){l++;let u=s;if(s=null,u)try{await u.endSession()}catch{}c(o==="failed"?"failed":"ended")}return{get state(){return o},start:p,stop:f,async toggle(){o==="connecting"||o==="live"?await f():await p()}}}var Rt="https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";async function Nt(){let t=await import(Rt);if(!t.Conversation)throw new Error("no conversation runtime in the loaded module");return t.Conversation}function ze(e,t,r=16e3){if(r>=t||e.length===0)return e;let o=t/r,s=new Float32Array(Math.floor(e.length/o));for(let l=0;l<s.length;l++){let c=Math.floor(l*o),i=Math.min(e.length,Math.floor((l+1)*o)),p=0;for(let f=c;f<i;f++)p+=e[f];s[l]=i>c?p/(i-c):0}return s}function Ue(e){let t=new Int16Array(e.length);for(let r=0;r<e.length;r++){let o=Math.max(-1,Math.min(1,e[r]));t[r]=o<0?o*32768:o*32767}return t}function We(e){if(e.length===0)return 0;let t=0;for(let r of e)t+=r*r;return Math.min(1,Math.sqrt(t/e.length)/32768)}var It=`
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
`,Ot={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:1},Ft=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"];function ve(){let e=globalThis.MediaRecorder;return e?.isTypeSupported?Ft.find(t=>e.isTypeSupported?.(t))??null:null}async function Be(e){let t=e.frameMs??20,{context:r,stream:o}=await(e.open??Pt)(),s=Math.round(r.sampleRate*t/1e3),l=r.createMediaStreamSource(o),c=URL.createObjectURL(new Blob([It],{type:"application/javascript"}));try{await r.audioWorklet.addModule(c)}finally{URL.revokeObjectURL(c)}let i=new AudioWorkletNode(r,"recourse-capture",{numberOfInputs:1,numberOfOutputs:0,processorOptions:{frameSamples:s}});i.port.onmessage=f=>{let u=ze(f.data,r.sampleRate,16e3);e.onFrame(Ue(u))},l.connect(i);let p=null;if(e.onCompressed){let f=ve();if(f){let u=!0;p=(e.record??Ht)(o,f,e.chunkMs??200,b=>{let x=u;u=!1,b.size!==0&&b.arrayBuffer().then(v=>e.onCompressed?.(v,x))})}}return{async stop(){i.port.onmessage=null,p?.stop(),l.disconnect(),i.disconnect();for(let f of o.getTracks())f.stop();await r.close()}}}function Ht(e,t,r,o){let s=new MediaRecorder(e,{mimeType:t});return s.ondataavailable=l=>o(l.data),s.start(r),{stop:()=>{try{s.state!=="inactive"&&s.stop()}catch{}}}}async function Pt(){let e=await navigator.mediaDevices.getUserMedia({audio:Ot});return{context:new AudioContext,stream:e}}function je(e){let t=e.cushionSeconds??.05,r=0;return{get endsAt(){return r},get playing(){return r>e.now()},push(o){if(o.length===0)return;let s=e.now(),l=r>s?r:s+t;e.play(o,l),r=l+o.length/e.sampleRate},clear(){r=0}}}function $e(e){let t="idle",r=null,o=null,s=null,l=null,c=0,i=m=>{t!==m&&(t=m,e.onStateChange?.(m))},p=m=>{i("failed"),e.onError?.(m)};async function f(){let m=o,w=s,M=r;o=null,s=null,l=null,r=null;try{M?.close()}catch{}await m?.stop().catch(()=>{}),w?.stop(),await w?.close().catch(()=>{})}async function u(){if(t==="connecting"||t==="live")return;let m=++c;i("connecting");let w;try{w=(e.connect??Ut)(zt(e.endpoint))}catch{m===c&&p("Could not reach the server to start the call.");return}w.binaryType="arraybuffer",r=w,w.onopen=()=>{if(m!==c){w.close();return}let M=e.compress===!1?null:ve();w.send(JSON.stringify({type:"hello",sampleRate:16e3,conversationId:e.conversationId(),...M?{audio:{mimeType:M}}:{}})),b(m,w,M)},w.onmessage=M=>{if(m===c){if(typeof M.data=="string"){let T;try{T=JSON.parse(M.data)}catch{return}T.type==="transcript"&&T.text&&T.role&&e.onTranscript?.({role:T.role,text:T.text}),T.type==="interrupted"&&(s?.stop(),l?.clear()),T.type==="error"&&e.onError?.(T.message??"Something went wrong.");return}M.data instanceof ArrayBuffer&&x(m,M.data)}},w.onerror=()=>{m===c&&(f(),p("The call was cut off."))},w.onclose=()=>{m===c&&(f(),(t==="live"||t==="connecting")&&i("ended"))}}async function b(m,w,M){try{s=(e.audio??Wt)(),l=je({now:s.now,play:s.play,sampleRate:s.sampleRate});let T=[],j=()=>{T.length===0||!xe(w)||(w.send(JSON.stringify({type:"levels",values:T,frameMs:20})),T=[])};if(o=await(e.microphone??Be)({onFrame:S=>{if(!(m!==c||!xe(w))){if(M){T.push(We(S)),T.length>=5&&j();return}w.send(S)}},...M?{onCompressed:S=>{m!==c||!xe(w)||(j(),w.send(S))}}:{}}),m!==c){await f();return}i("live")}catch{if(m!==c)return;await f(),p("Could not use your microphone. It may be blocked for this site.")}}async function x(m,w){try{let M=await s?.decode(w);if(m!==c||!M)return;l?.push(M)}catch{}}async function v(){c++,await f(),i(t==="failed"?"failed":"ended")}return{get state(){return t},start:u,stop:v,async toggle(){t==="connecting"||t==="live"?await v():await u()}}}function xe(e){return e.readyState===1||e.readyState==="open"}function zt(e){if(/^wss?:\/\//i.test(e))return e;let t=new URL(e,location.href);return t.protocol=t.protocol==="https:"?"wss:":"ws:",t.toString()}function Ut(e){return new WebSocket(e)}function Wt(){let e=new AudioContext,t=[];return{sampleRate:e.sampleRate,now:()=>e.currentTime,decode:async r=>(await e.decodeAudioData(r)).getChannelData(0),play:(r,o)=>{let s=e.createBuffer(1,r.length,e.sampleRate);s.getChannelData(0).set(r);let l=e.createBufferSource();l.buffer=s,l.connect(e.destination),l.onended=()=>{t=t.filter(c=>c!==l)},l.start(o),t.push(l)},stop:()=>{for(let r of t)try{r.stop()}catch{}t=[]},close:()=>e.close()}}var _e=`
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
  /* Recording and connecting are the two states the widget signals with colour
     alone on the button, so each one needs a value that clears contrast on the
     ground it sits on. A single red does not: it goes muddy on dark. */
  --rc-alert: #d92d20;
  --rc-alert-ink: #b42318;
  --rc-wait: #b54708;
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
  --rc-alert: #f0554f;
  --rc-alert-ink: #f0554f;
  --rc-wait: #f5a524;
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
  /* Wraps rather than truncates. A page and the heading inside it do not fit
     on one line in a panel this narrow, and "What it c..." names nothing the
     reader can recognise or decide to open. Bounded by the panel instead of a
     fixed width, so it holds at any size the host gives it. */
  max-width: 100%;
  overflow-wrap: break-word;
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
  background: var(--rc-alert);
  animation: hd-pulse 1.4s ease-in-out infinite;
}
/* A microphone drawn on a live button still reads as "start". The square is
   what every recorder in the world uses for stop, so it is what the button
   shows once it is running. */
.composer button.mic .stop {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: currentColor;
}
@keyframes hd-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--rc-halo); }
  50% { box-shadow: 0 0 0 6px rgba(0, 0, 0, 0); }
}
.composer button.mic[data-recording="true"] { --rc-halo: rgba(217, 45, 32, 0.5); }
:host([data-theme="dark"]) .composer button.mic[data-recording="true"] { --rc-halo: rgba(240, 85, 79, 0.55); }
/* Connecting is a wait with no progress to show, so the pulse is the only
   signal that the press was heard. Live is steady, because a call that is up
   does not need to keep announcing itself. Amber rather than the recording red,
   because "placing a call" and "on a call" are different things to be told. */
.composer button.call[data-state="connecting"] {
  color: var(--rc-wait);
  border: 1.5px solid var(--rc-wait);
  --rc-halo: rgba(181, 71, 8, 0.4);
  animation: hd-pulse 1.4s ease-in-out infinite;
}
:host([data-theme="dark"]) .composer button.call[data-state="connecting"] { --rc-halo: rgba(245, 165, 36, 0.45); }
.composer button.call[data-state="connecting"]:hover { background: transparent; color: var(--rc-wait); }
.composer button.call[data-state="live"] {
  color: #fff;
  background: var(--rc-alert);
}
.composer button.call[data-state="live"]:hover { background: var(--rc-alert); color: #fff; }
/* A call that failed leaves a mark on the button, because the error box above
   is dismissed by the next thing that happens and the failure is not. */
.composer button.call { position: relative; }
.composer button.call .failed {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--rc-alert);
  border: 2px solid var(--rc-panel);
}
/* One line under the composer for whichever of the two is running. Announced,
   not just coloured, so it reaches a screen reader as it changes. */
/* An author display rule beats the browser's own rule for the hidden
   attribute, so without this the line is on whether anything is running or
   not. */
.status[hidden] { display: none; }
.status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 8px 12px 0;
  font-size: 12px;
  color: var(--rc-alert-ink);
}
.status .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
.status[data-kind="connecting"] { color: var(--rc-wait); }
.status[data-kind="connecting"] .dot { border-radius: 2px; }
@media (prefers-reduced-motion: reduce) {
  .composer button.mic[data-recording="true"],
  .composer button.call[data-state="connecting"] { animation: none; }
}
/* The empty panel, when the host gave it a picture. Centred in the log rather
   than pinned to the top, because the point is to fill the space. */
.empty {
  margin: auto 0;
  padding: 24px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.empty img {
  width: 150px;
  height: auto;
  /* A short window is the case this has to survive: the picture gives up its
     height before the greeting does, and disappears rather than squashing. */
  max-height: min(150px, 26vh);
  min-height: 72px;
  object-fit: contain;
}
@media (max-height: 620px) {
  .empty img { display: none; }
}
.empty p {
  margin: 0;
  text-align: center;
  max-width: 28ch;
  color: var(--rc-ink);
}
/* Drawn in near black, so on a dark panel it is inverted rather than shipped
   a second time. */
:host([data-theme="dark"]) .empty img { filter: invert(1) brightness(1.35); }
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

.footnote {
  margin: 0;
  padding: 0 12px 8px;
  font-size: 11px;
  opacity: 0.6;
  text-align: center;
}
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
`;var Ve={title:"Ask us anything",open:"Open the support chat",close:"Close the support chat",placeholder:"Type your question",send:"Send",inputLabel:"Your question",attach:"Attach a file",removeFile:"Remove {name}",dictate:"Dictate your question",stopDictating:"Stop dictating",listening:"Listening, press again to stop",call:"Talk to us",endCall:"End the call",calling:"Connecting, this can take a few seconds",onCall:"On a call \xB7 {time}",callAgain:"Call again, the last call failed",callStarted:"Call started",callEnded:"Call ended",working:"Checking {name}",helpful:"This helped",notHelpful:"This did not help",thanks:"Thanks, that helps us improve.",copy:"Copy this answer",copied:"Copied",deleteConversation:"Delete this conversation",deleteConfirm:"Delete this conversation? It cannot be brought back.",offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status}).",submit:"Send",submitted:"Thanks, sending that now.",dismiss:"Dismiss"};function qe(e){if(!e)return Ve;let t={...Ve};for(let[r,o]of Object.entries(e))typeof o=="string"&&o.trim().length>0&&(t[r]=o);return t}function ae(e,t){return e.replace(/\{(\w+)\}/g,(r,o)=>o in t?String(t[o]):r)}var Bt=["recourse_q","rc_q"];function jt(e={}){let t=e.params??Bt,r;try{r=new URL(e.href??window.location.href)}catch{return null}let o=null;for(let s of t){let l=r.searchParams.get(s);if(l&&l.trim()){o=l.trim().slice(0,1e3);break}}if(o===null)return null;if(e.strip!==!1){for(let s of t)r.searchParams.delete(s);try{window.history.replaceState(window.history.state,"",r.toString())}catch{}}return o}function Ke(e,t={}){let r=jt(t);return r===null?null:(e.open(),e.ask(r),r)}function Ye(e){return`recourse:transcript:${e}`}function Ge(e){return`recourse:invite:${e}`}var z={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z",clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",mic:"M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",phone:"M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",hangUp:"M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"},$t=["image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/markdown","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];function Xe(e){if(!e.endpoint)throw new Error("recourse: an `endpoint` is required");let t=qe(e.strings),r=!!e.target,o=document.createElement("div");o.setAttribute("data-recourse",""),r&&o.setAttribute("data-inline","true"),o.style.cssText=r?"display:block;width:100%;height:100%":"";let s=o.attachShadow({mode:"open"}),l=document.createElement("style");l.textContent=_e,s.appendChild(l),e.accent&&o.style.setProperty("--rc-accent",e.accent),_t(o,e.theme??"auto");let c=e.position==="bottom-left"?"pos-left":"pos-right",i={messages:e.persist===!1?[]:qt(e.endpoint),busy:!1,controller:null,conversationId:`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,suggestions:e.suggestions??[],staged:[]},p={...e.actions},f=[],u=new Map;function b(n,a){for(let d of u.get(n)??[])try{d(a)}catch(g){console.error(`[recourse] listener for "${n}" threw`,g)}}let x=document.createElement("button");x.className=`launcher ${c}`,x.type="button",x.setAttribute("aria-label",t.open),x.setAttribute("aria-expanded","false"),x.appendChild(D(z.chat,!0));let v=document.createElement("div");v.className=`panel ${c}`,v.setAttribute("role","dialog"),v.setAttribute("aria-modal","false"),v.setAttribute("aria-label",e.title??t.title),v.dataset.open=String(r||e.open===!0);let m=document.createElement("div");m.className="header";let w=document.createElement("div");w.className="grow";let M=document.createElement("h2");if(M.textContent=e.title??t.title,w.appendChild(M),e.subtitle){let n=document.createElement("p");n.textContent=e.subtitle,w.appendChild(n)}m.appendChild(w);let T=document.createElement("button");T.className="icon-button",T.type="button",T.setAttribute("aria-label",t.deleteConversation),T.appendChild(D("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z",!1)),e.allowDelete&&m.appendChild(T);let j=document.createElement("button");j.className="icon-button",j.type="button",j.setAttribute("aria-label",t.close),j.appendChild(D(z.close,!1)),r||m.appendChild(j);let S=document.createElement("div");S.className="log",S.setAttribute("role","log"),S.setAttribute("aria-live","polite"),S.setAttribute("aria-relevant","additions text"),S.setAttribute("aria-live","polite"),S.setAttribute("aria-relevant","additions text");let te=document.createElement("div");te.className="suggestions";let _=document.createElement("div");_.className="error",_.hidden=!0,_.setAttribute("role","alert");let X=document.createElement("form");X.className="composer";let k=document.createElement("textarea");k.setAttribute("dir","auto"),k.rows=1,k.placeholder=t.placeholder,k.setAttribute("aria-label",t.inputLabel);let V=document.createElement("button");V.type="submit",V.setAttribute("aria-label",t.send),V.appendChild(D(z.send,!0));let O=e.attachments?{maxBytes:(typeof e.attachments=="object"?e.attachments.maxBytes:void 0)??10*1024*1024,maxCount:(typeof e.attachments=="object"?e.attachments.maxCount:void 0)??4,accept:(typeof e.attachments=="object"?e.attachments.accept:void 0)??$t}:null,G=document.createElement("div");G.className="tray",G.hidden=!0;let F=document.createElement("input");F.type="file",F.multiple=!0,F.hidden=!0,F.tabIndex=-1;let J=document.createElement("button");J.type="button",J.className="attach",J.setAttribute("aria-label",t.attach),J.appendChild(D(z.clip,!1));let ye=e.dictation?typeof e.dictation=="object"?e.dictation:{}:null,U=document.createElement("button");U.type="button",U.className="mic",U.setAttribute("aria-label",t.dictate),U.appendChild(D(z.mic,!1));let H=null,we=!1,ke;O&&(F.accept=O.accept.join(",")),ye&&(H=He({...ye,onStateChange:n=>{U.dataset.recording=String(n),U.setAttribute("aria-label",n?t.stopDictating:t.dictate),U.setAttribute("aria-pressed",String(n)),U.replaceChildren(n?Object.assign(document.createElement("span"),{className:"stop"}):D(z.mic,!1)),n?Q("listening",t.listening):we||Q(null),n||(k.dataset.interim="")},onInterim:n=>{k.value=`${k.dataset.beforeDictation??""}${n}`},onFinal:n=>{let a=k.dataset.beforeDictation??"",d=a&&!a.endsWith(" ")?`${a} ${n}`:`${a}${n}`;k.value=d,k.dataset.beforeDictation=d},onError:n=>q(n)}),H&&(U.addEventListener("click",()=>{H&&(H.recording||(k.dataset.beforeDictation=k.value),H.toggle(),k.focus())}),k.addEventListener("keydown",n=>{n.key==="Escape"&&H?.recording&&(n.preventDefault(),k.value=k.dataset.beforeDictation??"",H.cancel())})));let Ce=typeof e.call=="string"?e.call:e.call?e.call.endpoint:null,Ee=typeof e.call=="object"?e.call.load:void 0,Ze=typeof e.call=="object"?e.call.transport:void 0,W=document.createElement("button");W.type="button",W.className="call",W.setAttribute("aria-label",t.call),W.appendChild(D(z.phone,!1));let ie=null;if(Ce){let n={endpoint:Ce,conversationId:()=>i.conversationId,onStateChange:a=>et(a),onTranscript:({role:a,text:d})=>{Z({role:a==="visitor"?"user":"assistant",content:d})},onError:a=>q(a)};ie=Ze==="hosted"?$e(n):Pe({...n,...Ee?{load:Ee}:{}}),W.addEventListener("click",()=>{ie?.toggle()})}function et(n){W.dataset.state=n;let a=n==="live"||n==="connecting",d=n==="failed";if(W.setAttribute("aria-label",a?t.endCall:d?t.callAgain:t.call),W.replaceChildren(D(a?z.hangUp:z.phone,!1)),d&&W.appendChild(Object.assign(document.createElement("span"),{className:"failed"})),clearInterval(ke),n==="live"){let g=Date.now(),h=()=>Q("live",ae(t.onCall,{time:Vt(g)}));h(),ke=setInterval(h,1e3)}else n==="connecting"?Q("connecting",t.calling):H?.recording||Q(null);we=a,n==="live"&&re(t.callStarted),n==="ended"&&re(t.callEnded)}let tt=H?[U]:[],nt=ie?[W]:[];X.append(...O?[J]:[],k,...tt,...nt,V);let se=document.createElement("p");se.className="footnote",t.footnote&&(se.textContent=t.footnote);let B=document.createElement("p");B.className="status",B.setAttribute("role","status"),B.setAttribute("aria-live","polite"),B.hidden=!0,B.append(Object.assign(document.createElement("span"),{className:"dot"}));let le=document.createElement("span");B.appendChild(le);function Q(n,a=""){if(B.hidden=n===null,n===null){le.textContent="",B.removeAttribute("data-kind");return}B.dataset.kind=n,le.textContent=a}v.append(m,S,te,_,G,X,B,...t.footnote?[se]:[]),O&&v.appendChild(F),r?s.append(v):s.append(x,v),(e.target??document.body).appendChild(o),O&&(J.addEventListener("click",()=>F.click()),F.addEventListener("change",()=>{F.files&&ce(F.files),F.value=""}),v.addEventListener("dragover",n=>{n.dataTransfer?.types.includes("Files")&&(n.preventDefault(),v.dataset.dropping="true")}),v.addEventListener("dragleave",()=>{delete v.dataset.dropping}),v.addEventListener("drop",n=>{n.dataTransfer?.files.length&&(n.preventDefault(),delete v.dataset.dropping,ce(n.dataTransfer.files))}),k.addEventListener("paste",n=>{let a=Array.from(n.clipboardData?.files??[]);a.length!==0&&(n.preventDefault(),ce(a))}));function Y(n){b(n?"open":"close",{}),n&&s.querySelector(".invite")?.remove(),v.dataset.open=String(n),x.setAttribute("aria-expanded",String(n)),x.setAttribute("aria-label",n?t.close:t.open),n?k.focus():x.focus()}function q(n){_.textContent=n,_.hidden=!1}async function ce(n){if(O){_.hidden=!0;for(let a of Array.from(n)){if(i.staged.length>=O.maxCount){q(`You can attach ${O.maxCount} files at a time.`);break}let d=(a.type||"").split(";")[0]?.trim().toLowerCase()??"";if(!O.accept.includes(d)){q(`${a.name} is not a file type we can read.`);continue}if(a.size>O.maxBytes){q(`${a.name} is larger than ${Math.round(O.maxBytes/1024/1024)}MB.`);continue}let g;try{g=await Kt(a)}catch{q(`${a.name} could not be read.`);continue}i.staged.push({name:a.name,mimeType:d,dataUrl:g,bytes:a.size})}de()}}function de(){G.replaceChildren(),G.hidden=i.staged.length===0;for(let[n,a]of i.staged.entries()){let d=document.createElement("span");d.className="chip";let g=document.createElement("span");g.textContent=a.name,d.appendChild(g);let h=document.createElement("button");h.type="button",h.setAttribute("aria-label",ae(t.removeFile,{name:a.name})),h.appendChild(D(z.close,!1)),h.addEventListener("click",()=>{i.staged.splice(n,1),de(),k.focus()}),d.appendChild(h),G.appendChild(d)}}function K(){S.scrollTop=S.scrollHeight}function rt(n,a){let d=new Set;for(let N of a.matchAll(/\[(\d{1,2})\]/g))d.add(Number.parseInt(N[1],10)-1);let g=n.map((N,$)=>({ref:N,position:$})),h=g.filter(N=>d.has(N.position)),y=h.length>0?h:g,R=h.length>0,P=new Map,L=[],C=[];for(let N of y){let $=`${N.ref.url??""}|${N.ref.title}|${N.ref.section??""}`,A=P.get($);if(A!==void 0){R&&C[A]?.push(N.position+1);continue}P.set($,L.length),L.push(N.ref),C.push(R?[N.position+1]:[])}return{sources:L,citedAs:C}}function Se(n,a,d=[]){if(a.length===0)return;let g=document.createElement("div");g.className="sources";for(let[h,y]of a.slice(0,4).entries()){let R=y.section?`${y.title} \xB7 ${y.section}`:y.title,P=d[h]??[],L=P.length>0?`${P.map(N=>`[${N}]`).join(" ")} ${R}`:R,C=document.createElement(y.url?"a":"span");C.textContent=L,y.url&&C instanceof HTMLAnchorElement&&(C.href=y.url,C.target="_blank",C.rel="noopener noreferrer"),g.appendChild(C)}n.appendChild(g)}function Z(n){S.querySelector(".empty")?.remove();let a=document.createElement("div");a.className="msg",a.dataset.role=n.role;let d=document.createElement("div");return d.className="bubble",d.setAttribute("dir","auto"),n.role==="user"?d.textContent=n.content:d.appendChild(ee(n.content)),n.role==="user"&&!n.content&&n.attachments?.length?d.remove():a.appendChild(d),n.attachments?.length&&mt(a,n.attachments),n.sources&&Se(a,n.sources,n.citedAs),S.appendChild(a),K(),{bubble:d,wrapper:a}}function ue(){if(te.replaceChildren(),i.suggestions.length!==0)for(let n of i.suggestions.slice(0,4)){let a=document.createElement("button");a.type="button",a.textContent=n,a.addEventListener("click",()=>{ne(n)}),te.appendChild(a)}}function Ae(){S.replaceChildren(),e.greetingArt&&i.messages.length===0?ot():e.greeting&&Z({role:"assistant",content:e.greeting});for(let n of i.messages)Z(n);ue()}function ot(){let n=document.createElement("div");n.className="empty";let a=document.createElement("img");if(a.src=e.greetingArt,a.alt="",a.decoding="async",n.appendChild(a),e.greeting){let d=document.createElement("p");d.textContent=e.greeting,n.appendChild(d)}S.appendChild(n)}function at(n){if(e.copy===!1||typeof navigator>"u"||!navigator.clipboard?.writeText)return;let a=document.createElement("button");return a.type="button",a.className="icon-button",a.setAttribute("aria-label",t.copy),a.appendChild(D("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z",!0)),a.addEventListener("click",()=>{navigator.clipboard.writeText(n).then(()=>{a.setAttribute("aria-label",t.copied),a.setAttribute("data-copied","true"),setTimeout(()=>{a.setAttribute("aria-label",t.copy),a.removeAttribute("data-copied")},1600)}).catch(()=>{})}),a}function Te(){i.messages=[],i.suggestions=e.suggestions??[],i.conversationId=`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,Je(e.endpoint,[],e.persist!==!1),Ae()}async function Me(){let n=i.conversationId;Te();try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deleteConversation:n})})}catch{}}function it(n,a,d=""){let g=at(d);if(e.feedback===!1){if(!g)return;let y=document.createElement("div");y.className="feedback",y.appendChild(g),n.appendChild(y);return}let h=document.createElement("div");h.className="feedback";for(let[y,R,P]of[["positive",t.helpful,"M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],["negative",t.notHelpful,"M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]]){let L=document.createElement("button");L.type="button",L.className="icon-button",L.setAttribute("aria-label",R),L.appendChild(D(P,!0)),L.addEventListener("click",()=>{L.setAttribute("aria-pressed","true"),h.querySelectorAll("button").forEach(C=>{C!==L&&C.removeAttribute("aria-pressed")}),st(a,y).then(C=>{C||L.removeAttribute("aria-pressed")})}),h.appendChild(L)}g&&h.appendChild(g),n.appendChild(h)}async function st(n,a){try{return(await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feedback:{conversationId:i.conversationId,messageIndex:n,value:a}})})).ok}catch{return!1}}async function ne(n){let a=n.trim();if(!a&&i.staged.length===0||i.busy)return;_.hidden=!0,i.busy=!0,V.disabled=!0,H?.recording&&H.cancel(),k.dataset.beforeDictation="";let d=i.staged;i.staged=[],de();let g={role:"user",content:a};d.length>0&&(g.attachments=d),i.messages.push(g),Z(g),b("message",{text:a}),i.suggestions=[],ue(),i.controller=new AbortController,await pe(void 0,d),i.busy=!1,V.disabled=!1,i.controller=null,K(),k.focus()}async function pe(n,a){let{bubble:d,wrapper:g}=Z({role:"assistant",content:""});S.setAttribute("aria-busy","true");let h=document.createElement("span");h.className="typing",h.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),d.appendChild(h);let y=null,R="",P=A=>{R+=A,L(lt(R))},L=A=>{if(!C.content){if(!A){y?.remove(),y=null,d.contains(h)||d.appendChild(h);return}h.remove(),y??(y=document.createElement("div")),y.className="working",y.textContent=ae(t.working,{name:A}),d.contains(y)||d.appendChild(y),K()}},C={role:"assistant",content:""},N=[],$=[];if(await Fe(e.endpoint,{messages:i.messages,conversationId:i.conversationId,userId:e.userId,userHash:e.userHash,contact:e.contact,actionResults:n,...a&&a.length>0?{attachments:a}:{}},{onSources:A=>{N=A},onDelta:A=>{h.remove(),y?.remove(),y=null,C.content+=A,d.replaceChildren(ee(C.content)),K()},onError:A=>{h.remove(),y?.remove(),y=null,q(A),b("error",{message:A})},onFrame:A=>dt(A,$,L,P)},i.controller?.signal,t).finally(()=>{h.remove(),S.setAttribute("aria-busy","false")}),$.length>0&&!n){g.remove();let A=$.find(fe=>fe.payload?.form);if(A){me={name:A.name,input:A.input};let fe=Ie(A.payload?.form,Le),oe=document.createElement("div");oe.className="msg",oe.dataset.role="assistant",oe.appendChild(fe),S.appendChild(oe),K();return}let gt=await pt($);await pe(gt);return}if(C.content.trim()){let A=rt(N,C.content);C.sources=A.sources,C.citedAs=A.citedAs,i.messages.push(C),Se(g,C.sources,C.citedAs),it(g,i.messages.length-1,C.content),Je(e.endpoint,i.messages,e.persist!==!1),b("response",{text:C.content,sources:C.sources})}else g.remove();ue()}function lt(n){let a=n.split(`
`).filter(g=>g.trim()),d=a[a.length-1]??"";return d.length>120?`${d.slice(-120).trimStart()}`:d}function ct(n){return n.replace(/[_-]+/g," ").trim()}function dt(n,a,d=()=>{},g=()=>{}){if(n.type==="client-action")a.push({id:n.id,name:n.name,input:n.input,payload:n.payload});else if(n.type==="suggestions")i.suggestions=n.items;else if(n.type==="reasoning")g(n.text);else if(n.type==="action")b("action",{name:n.name,status:n.status}),d(n.status==="running"?n.summary??ct(n.name):null);else if(n.type==="captured")b("captured",{kind:n.kind,name:n.name,values:n.values});else if(n.type==="notice")re(n.message);else if(n.type==="handoff")b("handoff",{ticketId:n.ticketId,message:n.message}),re(n.message);else if(n.type==="ui"){let h=Oe({kind:n.kind,id:n.id,data:n.data},Le);if(h){let y=n.id?[...S.children].find(P=>P.dataset?.uiId===n.id):void 0,R=document.createElement("div");R.className="msg",R.dataset.role="assistant",n.id&&(R.dataset.uiId=n.id),R.appendChild(h),y?y.replaceWith(R):(S.appendChild(R),K())}}}let Le={submit:n=>{ne(n)},respond:n=>{ut(n)},run:async(n,a)=>{let d=p[n];if(!d)throw new Error("That is not available here");return d(a)}},me=null;async function ut(n){let a=me;me=null,!(!a||i.busy)&&(i.busy=!0,V.disabled=!0,i.controller=new AbortController,await pe([{name:a.name,input:a.input,output:n}]),i.busy=!1,V.disabled=!1,i.controller=null)}async function pt(n){return Promise.all(n.map(async a=>{let d=p[a.name];if(!d)return{name:a.name,input:a.input,output:{error:"no handler registered on this page"}};try{return{name:a.name,input:a.input,output:await d(a.input)}}catch(g){return{name:a.name,input:a.input,output:{error:g instanceof Error?g.message:String(g)}}}}))}function mt(n,a){let d=document.createElement("div");d.className="attached";for(let g of a){if(g.mimeType.startsWith("image/")){let y=document.createElement("img");y.src=g.dataUrl,y.alt=g.name,d.appendChild(y);continue}let h=document.createElement("span");h.className="chip",h.textContent=g.name,d.appendChild(h)}n.appendChild(d)}function re(n){let a=document.createElement("div");a.className="notice",a.textContent=n,S.appendChild(a),K()}function ft(){if(r||!e.invite||v.dataset.open==="true")return;try{if(sessionStorage.getItem(Ge(e.endpoint)))return}catch{}let n=document.createElement("div");n.className=`invite ${c}`,n.setAttribute("role","button"),n.tabIndex=0,n.appendChild(document.createTextNode(e.invite));let a=document.createElement("button");a.type="button",a.className="invite-dismiss",a.setAttribute("aria-label",t.dismiss),a.appendChild(D(z.close,!1));let d=()=>{n.remove();try{sessionStorage.setItem(Ge(e.endpoint),"1")}catch{}};a.addEventListener("click",h=>{h.stopPropagation(),d()});let g=()=>{d(),Y(!0)};n.addEventListener("click",g),n.addEventListener("keydown",h=>{(h.key==="Enter"||h.key===" ")&&(h.preventDefault(),g())}),n.appendChild(a),s.appendChild(n)}if(e.invite&&!r){let n=e.inviteDelay??4e3,a=setTimeout(ft,n);f.push(a)}x.addEventListener("click",()=>Y(v.dataset.open!=="true")),j.addEventListener("click",()=>Y(!1)),T.addEventListener("click",()=>{typeof window.confirm=="function"&&!window.confirm(t.deleteConfirm)||Me()}),X.addEventListener("submit",n=>{n.preventDefault();let a=k.value;k.value="",k.style.height="auto",ne(a)}),k.addEventListener("input",()=>{k.style.height="auto",k.style.height=`${k.scrollHeight}px`}),k.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),X.requestSubmit())}),s.addEventListener("keydown",n=>{n.key==="Escape"&&!r&&Y(!1)}),Ae();let Re={open:()=>Y(!0),close:()=>Y(!1),ask:ne,on(n,a){let d=u.get(n)??new Set;return d.add(a),u.set(n,d),()=>d.delete(a)},handle(n,a){p[n]=a},clear(){Te()},forget:()=>Me(),destroy(){i.controller?.abort();for(let n of f)clearTimeout(n);o.remove()},element:o};return e.deepLink!==!1&&Ke(Re),Re}function _t(e,t){if(t!=="auto"){e.setAttribute("data-theme",t);return}let r=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>e.setAttribute("data-theme",r.matches?"dark":"light");o(),r.addEventListener("change",o)}function Vt(e){let t=Math.max(0,Math.floor((Date.now()-e)/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`}function D(e,t){let r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("viewBox","0 0 24 24"),r.setAttribute("aria-hidden","true"),r.setAttribute("fill",t?"currentColor":"none"),r.setAttribute("stroke",t?"none":"currentColor"),r.setAttribute("stroke-width","2"),r.setAttribute("stroke-linecap","round");let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",e),r.appendChild(o),r}function qt(e){try{let t=sessionStorage.getItem(Ye(e));if(!t)return[];let r=JSON.parse(t);return Array.isArray(r)?r.filter(o=>{if(typeof o!="object"||o===null)return!1;let s=o;return(s.role==="user"||s.role==="assistant")&&typeof s.content=="string"}):[]}catch{return[]}}function Je(e,t,r){if(r)try{sessionStorage.setItem(Ye(e),JSON.stringify(t.slice(-20)))}catch{}}function Kt(e){return new Promise((t,r)=>{let o=new FileReader;o.onload=()=>t(String(o.result)),o.onerror=()=>r(new Error("unreadable")),o.readAsDataURL(e)})}function Gt(){let t=document.currentScript?.dataset??{},r=t.endpoint??window.recourseConfig?.endpoint;if(!r)return console.warn("[recourse] no data-endpoint on the script tag, widget not mounted"),null;let o=t.target?document.querySelector(t.target):null;return{endpoint:r,userId:t.userId,userHash:t.userHash,feedback:t.feedback!=="false",invite:t.invite,inviteDelay:t.inviteDelay?Number(t.inviteDelay):void 0,title:t.title,subtitle:t.subtitle,...t.footnote?{strings:{footnote:t.footnote}}:{},greeting:t.greeting,greetingArt:t.greetingArt,accent:t.accent,suggestions:t.suggestions?.split("|").map(s=>s.trim()).filter(Boolean),position:t.position==="bottom-left"?"bottom-left":"bottom-right",theme:t.theme==="dark"||t.theme==="light"?t.theme:"auto",open:t.open==="true",persist:t.persist!=="false",deepLink:t.deepLink!=="false",...Jt(t.attachments),...t.dictation==="true"?{dictation:{...t.dictationLang?{lang:t.dictationLang}:{},...t.dictationCloud==="true"?{allowCloudFallback:!0}:{}}}:{},...t.call?{call:t.callTransport==="hosted"?{endpoint:t.call,transport:"hosted"}:t.call}:{},copy:t.copy!=="false",allowDelete:t.delete==="true",...window.recourseConfig,...o?{target:o}:{}}}function Jt(e){if(!e||e==="false")return{};if(e==="true")return{attachments:!0};let t=Number(e);return Number.isFinite(t)&&t>0?{attachments:{maxBytes:Math.round(t*1024*1024)}}:{}}var Qe=Gt();if(Qe){let e=()=>{window.recourse=Xe(Qe)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e()}})();
