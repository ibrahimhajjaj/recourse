"use strict";(()=>{var st=/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,lt=/^(https?:|mailto:|\/|#)/i;function Y(e){let t=document.createDocumentFragment();for(let n of ct(e))t.appendChild(dt(n));return t}function ct(e){let t=[],n=null,o=null,l=()=>{n&&n.lines.length>0&&t.push(n),n=null};for(let s of e.split(`
`)){if(/^\s*(```|~~~)/.test(s)){o?(t.push(o),o=null):(l(),o={kind:"code",lines:[]});continue}if(o){o.lines.push(s);continue}if(s.trim()===""){l();continue}let c=/^\s*[-*+]\s+(.*)$/.exec(s),a=/^\s*\d+[.)]\s+(.*)$/.exec(s),p=c?"ul":a?"ol":"p",m=c?.[1]??a?.[1]??s;(!n||n.kind!==p)&&(l(),n={kind:p,lines:[]}),n.lines.push(m)}return o&&t.push(o),l(),t}function dt(e){if(e.kind==="code"){let n=document.createElement("pre"),o=document.createElement("code");return o.textContent=e.lines.join(`
`),n.appendChild(o),n}if(e.kind==="ul"||e.kind==="ol"){let n=document.createElement(e.kind);for(let o of e.lines){let l=document.createElement("li");l.appendChild(Ee(o)),n.appendChild(l)}return n}let t=document.createElement("p");return t.appendChild(Ee(e.lines.join(" "))),t}function Ee(e){let t=document.createDocumentFragment();for(let n of e.split(st)){if(!n)continue;if(n.startsWith("**")&&n.endsWith("**")){t.appendChild(ce("strong",n.slice(2,-2)));continue}if(n.startsWith("`")&&n.endsWith("`")){t.appendChild(ce("code",n.slice(1,-1)));continue}if(n.startsWith("*")&&n.endsWith("*")&&n.length>2){t.appendChild(ce("em",n.slice(1,-1)));continue}let o=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(n);if(o){let l=o[2];if(lt.test(l)){let s=document.createElement("a");s.textContent=o[1],s.href=l,s.target="_blank",s.rel="noopener noreferrer",t.appendChild(s)}else t.appendChild(document.createTextNode(o[1]));continue}t.appendChild(document.createTextNode(n))}return t}function ce(e,t){let n=document.createElement(e);return n.textContent=t,n}var ue=/^(https?:|mailto:|tel:|\/|#)/i;function de(e,t){let n=e.showIf;if(n===void 0)return!0;if(typeof n=="boolean")return n;if(typeof n=="string"){let o=n.startsWith("!"),l=o?n.slice(1):n,[s,c]=l.split("=",2),a=t[(s??"").trim()],p=c===void 0?!!a:String(a)===c.trim();return o?!p:p}return!0}function R(e,t,n){let o=document.createElement(e);return o.textContent=t,n&&(o.className=n),o}function C(e){return typeof e=="string"?e:e==null?"":String(e)}function Se(e,t,n){if(!ue.test(t))return R("span",e,n);let o=document.createElement("a");return o.textContent=e,o.href=t,o.target="_blank",o.rel="noopener noreferrer",o.className=n,o}var ut=e=>{let t=C(e.label)||"Open",n=C(e.url);if(!n)return null;let o=document.createElement("div");return o.className="ui-actions",o.appendChild(Se(t,n,"ui-button")),o};function pt(e,t){let n=C(e.label);if(!n)return null;if(e.url)return Se(n,C(e.url),"ui-button");let o=document.createElement("button");return o.type="button",o.className="ui-button",o.textContent=n,e.run?(o.addEventListener("click",async()=>{if(t.run){o.disabled=!0;try{await t.run(C(e.run),e.payload??{}),o.replaceWith(R("span",C(e.done)||"Done","ui-muted"))}catch(l){o.disabled=!1,o.textContent=l instanceof Error?l.message:"That did not work"}}}),o):(o.addEventListener("click",()=>t.submit(C(e.send)||n)),o)}var ft=(e,t)=>{let n=document.createElement("div");if(n.className="ui-card",e.image&&ue.test(C(e.image))){let c=document.createElement("img");c.src=C(e.image),c.alt=C(e.title),c.loading="lazy",c.className="ui-card-image",n.appendChild(c)}let o=document.createElement("div");o.className="ui-card-body",e.title&&o.appendChild(R("h3",C(e.title))),e.subtitle&&o.appendChild(R("p",C(e.subtitle),"ui-muted"));let l=(Array.isArray(e.fields)?e.fields:[]).filter(c=>de(c,e));if(l.length>0){let c=document.createElement("dl");c.className="ui-fields";for(let a of l){let p=a;c.appendChild(R("dt",C(p.label))),c.appendChild(R("dd",C(p.value)))}o.appendChild(c)}let s=(Array.isArray(e.actions)?e.actions:[]).filter(c=>de(c,e));if(s.length>0){let c=document.createElement("div");c.className="ui-actions";for(let a of s){let p=pt(a,t);p&&c.appendChild(p)}c.childElementCount>0&&o.appendChild(c)}return n.appendChild(o),n},mt=e=>{let t=(Array.isArray(e.columns)?e.columns:[]).map(C),n=Array.isArray(e.rows)?e.rows:[];if(t.length===0||n.length===0)return null;let o=document.createElement("div");o.className="ui-table-wrap";let l=document.createElement("table");l.className="ui-table";let s=document.createElement("thead"),c=document.createElement("tr");for(let p of t)c.appendChild(R("th",p));s.appendChild(c),l.appendChild(s);let a=document.createElement("tbody");for(let p of n.slice(0,25)){let m=document.createElement("tr"),d=Array.isArray(p)?p:t.map(h=>p[h]);for(let h of d)m.appendChild(R("td",C(h)));a.appendChild(m)}return l.appendChild(a),o.appendChild(l),o},gt=(e,t)=>{let n=(Array.isArray(e.items)?e.items:[]).filter(l=>de(l,e));if(n.length===0)return null;let o=document.createElement("div");o.className="ui-list";for(let l of n){let s=l,c=C(s.title);if(!c)continue;let a=document.createElement(s.url?"a":"button");a.className="ui-list-item",a instanceof HTMLAnchorElement&&ue.test(C(s.url))?(a.href=C(s.url),a.target="_blank",a.rel="noopener noreferrer"):a instanceof HTMLButtonElement&&(a.type="button",a.addEventListener("click",()=>t.submit(C(s.send)||c))),a.appendChild(R("span",c,"ui-list-title")),s.subtitle&&a.appendChild(R("span",C(s.subtitle),"ui-muted")),o.appendChild(a)}return o.childElementCount>0?o:null};function Ae(e,t){let n=document.createElement("form");n.className="ui-form",e.title&&n.appendChild(R("h3",e.title));let o=Array.isArray(e.fields)?e.fields:[],l=[];for(let a of o){let p=a,m=C(p.name);if(!m)continue;let d=document.createElement("label");d.className="ui-field",d.appendChild(R("span",C(p.label)||m));let h;if(Array.isArray(p.options)&&p.options.length>0){let y=document.createElement("select");for(let b of p.options){let f=document.createElement("option");f.value=C(b),f.textContent=C(b),y.appendChild(f)}h=y}else if(p.type==="boolean"){let y=document.createElement("input");y.type="checkbox",h=y}else{let y=document.createElement("input");y.type=p.type==="number"?"number":"text",p.placeholder&&(y.placeholder=C(p.placeholder)),h=y}h.name=m,p.required!==!1&&h instanceof HTMLInputElement&&h.type!=="checkbox"&&(h.required=!0),d.appendChild(h),n.appendChild(d),l.push({name:m,element:h})}let s=document.createElement("button");s.type="submit",s.className="ui-button",s.textContent=e.submitLabel||"Send",n.appendChild(s);let c=!1;return n.addEventListener("submit",a=>{if(a.preventDefault(),c)return;c=!0;let p={};for(let{name:m,element:d}of l)p[m]=d instanceof HTMLInputElement&&d.type==="checkbox"?d.checked:d.value;n.replaceChildren(Y("Thanks, sending that now.")),t.respond(p)}),n}var ht={button:ut,card:ft,table:mt,list:gt};function Te(e,t){let n=ht[e.kind];return n?n(e.data,t):null}var bt={offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status})."};async function Le(e,t,n,o,l=bt){let s;try{s=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,messages:t.messages.map(m=>({role:m.role,content:m.content}))}),signal:o})}catch{n.onError?.(l.offline);return}if(!s.ok||!s.body){n.onError?.(s.status===429?l.rateLimited:l.unavailable.replace("{status}",String(s.status)));return}let c=s.body.getReader(),a=new TextDecoder,p="";for(;;){let{done:m,value:d}=await c.read();if(m)break;p+=a.decode(d,{stream:!0});let h=p.split(`

`);p=h.pop()??"";for(let y of h){let b=y.split(`
`).find(w=>w.startsWith("data:"));if(!b)continue;let f;try{f=JSON.parse(b.slice(5).trim())}catch{continue}n.onFrame?.(f),f.type==="sources"?n.onSources?.(f.sources):f.type==="delta"?n.onDelta?.(f.text):f.type==="done"?n.onDone?.():f.type==="error"&&n.onError?.(f.message)}}n.onDone?.()}function vt(e=globalThis){let t=e;return t.SpeechRecognition??t.webkitSpeechRecognition??null}var xt={"not-allowed":"I need permission to use the microphone. You can allow it in your browser settings.","service-not-allowed":"Your browser would not let me use speech recognition.","no-speech":"I did not hear anything. Try again?","audio-capture":"I could not find a microphone.",network:"Speech recognition needs a connection and could not reach it.","language-not-supported":"Speech recognition is not available for this language on your device."};function Me(e={},t=globalThis){let n=vt(t);if(!n)return null;let o=n,l=null,s=!1;function c(m){let d=new o;d.continuous=!0,d.interimResults=!0,d.maxAlternatives=1;let h=e.lang??yt(t);return h&&(d.lang=h),m&&(d.processLocally=!0),d}function a(m){m.onstart=()=>e.onStateChange?.(!0),m.onresult=d=>{let h="";for(let y=d.resultIndex;y<d.results.length;y++){let b=d.results[y];if(!b)continue;let f=b[0]?.transcript??"";b.isFinal?e.onFinal?.(f):h+=f}h&&e.onInterim?.(h)},m.onerror=d=>{let h=e.processLocally!==!1,y=d.error==="language-not-supported"||d.error==="service-not-allowed";if(h&&y&&e.allowCloudFallback&&!s){s=!0,l=null,p(!1);return}d.error!=="aborted"&&e.onError?.(xt[d.error]??"Speech recognition stopped unexpectedly.")},m.onend=()=>{l=null,e.onStateChange?.(!1)}}function p(m){let d=c(m);a(d),l=d;try{d.start()}catch{l=null,e.onStateChange?.(!1)}}return{get recording(){return l!==null},start(){l||(s=!1,p(e.processLocally!==!1))},stop(){l?.stop()},cancel(){let m=l;l=null,m?.abort(),e.onStateChange?.(!1)},toggle(){l?this.stop():this.start()}}}function yt(e){return e.document?.documentElement?.lang??""}function Re(e){let t=e.fetch??globalThis.fetch.bind(globalThis),n=e.load??kt,o="idle",l=null,s=0,c=d=>{o!==d&&(o=d,e.onStateChange?.(d))},a=d=>{c("failed"),e.onError?.(d)};async function p(){if(o==="connecting"||o==="live")return;let d=++s;c("connecting");let h;try{let b=await t(e.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:e.conversationId()})});if(b.status===429){d===s&&a("Too many calls just now. Try again in a moment.");return}if(!b.ok){d===s&&a("Calling is not available right now.");return}let f=await b.json();if(typeof f.signedUrl!="string"||!f.signedUrl){d===s&&a("Calling is not available right now.");return}h=f.signedUrl}catch{d===s&&a("Could not reach the server to start the call.");return}if(d!==s)return;let y;try{y=await n()}catch{d===s&&a("Could not load the voice connection.");return}if(d===s)try{let b=await y.startSession({signedUrl:h,onConnect:()=>{d===s&&c("live")},onDisconnect:()=>{d===s&&(l=null,c("ended"))},onError:()=>{d===s&&a("The call ended unexpectedly. Your microphone may be blocked.")},onMessage:f=>{let w=typeof f?.message=="string"?f.message.trim():"";w&&e.onTranscript?.({role:f.source==="user"?"visitor":"agent",text:w})}});if(d!==s){await Promise.resolve(b.endSession()).catch(()=>{});return}l=b}catch{d===s&&a("Could not start the call. Your microphone may be blocked.")}}async function m(){s++;let d=l;if(l=null,d)try{await d.endSession()}catch{}c(o==="failed"?"failed":"ended")}return{get state(){return o},start:p,stop:m,async toggle(){o==="connecting"||o==="live"?await m():await p()}}}var wt="https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";async function kt(){let t=await import(wt);if(!t.Conversation)throw new Error("no conversation runtime in the loaded module");return t.Conversation}function Ne(e,t,n=16e3){if(n>=t||e.length===0)return e;let o=t/n,l=new Float32Array(Math.floor(e.length/o));for(let s=0;s<l.length;s++){let c=Math.floor(s*o),a=Math.min(e.length,Math.floor((s+1)*o)),p=0;for(let m=c;m<a;m++)p+=e[m];l[s]=a>c?p/(a-c):0}return l}function De(e){let t=new Int16Array(e.length);for(let n=0;n<e.length;n++){let o=Math.max(-1,Math.min(1,e[n]));t[n]=o<0?o*32768:o*32767}return t}function Ie(e){if(e.length===0)return 0;let t=0;for(let n of e)t+=n*n;return Math.min(1,Math.sqrt(t/e.length)/32768)}var Et=`
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
`,St={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:1},At=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"];function pe(){let e=globalThis.MediaRecorder;return e?.isTypeSupported?At.find(t=>e.isTypeSupported?.(t))??null:null}async function Oe(e){let t=e.frameMs??20,{context:n,stream:o}=await(e.open??Lt)(),l=Math.round(n.sampleRate*t/1e3),s=n.createMediaStreamSource(o),c=URL.createObjectURL(new Blob([Et],{type:"application/javascript"}));try{await n.audioWorklet.addModule(c)}finally{URL.revokeObjectURL(c)}let a=new AudioWorkletNode(n,"recourse-capture",{numberOfInputs:1,numberOfOutputs:0,processorOptions:{frameSamples:l}});a.port.onmessage=m=>{let d=Ne(m.data,n.sampleRate,16e3);e.onFrame(De(d))},s.connect(a);let p=null;if(e.onCompressed){let m=pe();if(m){let d=!0;p=(e.record??Tt)(o,m,e.chunkMs??200,h=>{let y=d;d=!1,h.size!==0&&h.arrayBuffer().then(b=>e.onCompressed?.(b,y))})}}return{async stop(){a.port.onmessage=null,p?.stop(),s.disconnect(),a.disconnect();for(let m of o.getTracks())m.stop();await n.close()}}}function Tt(e,t,n,o){let l=new MediaRecorder(e,{mimeType:t});return l.ondataavailable=s=>o(s.data),l.start(n),{stop:()=>{try{l.state!=="inactive"&&l.stop()}catch{}}}}async function Lt(){let e=await navigator.mediaDevices.getUserMedia({audio:St});return{context:new AudioContext,stream:e}}function Fe(e){let t=e.cushionSeconds??.05,n=0;return{get endsAt(){return n},get playing(){return n>e.now()},push(o){if(o.length===0)return;let l=e.now(),s=n>l?n:l+t;e.play(o,s),n=s+o.length/e.sampleRate},clear(){n=0}}}function He(e){let t="idle",n=null,o=null,l=null,s=null,c=0,a=f=>{t!==f&&(t=f,e.onStateChange?.(f))},p=f=>{a("failed"),e.onError?.(f)};async function m(){let f=o,w=l,A=n;o=null,l=null,s=null,n=null;try{A?.close()}catch{}await f?.stop().catch(()=>{}),w?.stop(),await w?.close().catch(()=>{})}async function d(){if(t==="connecting"||t==="live")return;let f=++c;a("connecting");let w;try{w=(e.connect??Rt)(Mt(e.endpoint))}catch{f===c&&p("Could not reach the server to start the call.");return}w.binaryType="arraybuffer",n=w,w.onopen=()=>{if(f!==c){w.close();return}let A=e.compress===!1?null:pe();w.send(JSON.stringify({type:"hello",sampleRate:16e3,conversationId:e.conversationId(),...A?{audio:{mimeType:A}}:{}})),h(f,w,A)},w.onmessage=A=>{if(f===c){if(typeof A.data=="string"){let E;try{E=JSON.parse(A.data)}catch{return}E.type==="transcript"&&E.text&&E.role&&e.onTranscript?.({role:E.role,text:E.text}),E.type==="interrupted"&&(l?.stop(),s?.clear()),E.type==="error"&&e.onError?.(E.message??"Something went wrong.");return}A.data instanceof ArrayBuffer&&y(f,A.data)}},w.onerror=()=>{f===c&&(m(),p("The call was cut off."))},w.onclose=()=>{f===c&&(m(),(t==="live"||t==="connecting")&&a("ended"))}}async function h(f,w,A){try{l=(e.audio??Nt)(),s=Fe({now:l.now,play:l.play,sampleRate:l.sampleRate});let E=[],P=()=>{E.length===0||!fe(w)||(w.send(JSON.stringify({type:"levels",values:E,frameMs:20})),E=[])};if(o=await(e.microphone??Oe)({onFrame:S=>{if(!(f!==c||!fe(w))){if(A){E.push(Ie(S)),E.length>=5&&P();return}w.send(S)}},...A?{onCompressed:S=>{f!==c||!fe(w)||(P(),w.send(S))}}:{}}),f!==c){await m();return}a("live")}catch{if(f!==c)return;await m(),p("Could not use your microphone. It may be blocked for this site.")}}async function y(f,w){try{let A=await l?.decode(w);if(f!==c||!A)return;s?.push(A)}catch{}}async function b(){c++,await m(),a(t==="failed"?"failed":"ended")}return{get state(){return t},start:d,stop:b,async toggle(){t==="connecting"||t==="live"?await b():await d()}}}function fe(e){return e.readyState===1||e.readyState==="open"}function Mt(e){if(/^wss?:\/\//i.test(e))return e;let t=new URL(e,location.href);return t.protocol=t.protocol==="https:"?"wss:":"ws:",t.toString()}function Rt(e){return new WebSocket(e)}function Nt(){let e=new AudioContext,t=[];return{sampleRate:e.sampleRate,now:()=>e.currentTime,decode:async n=>(await e.decodeAudioData(n)).getChannelData(0),play:(n,o)=>{let l=e.createBuffer(1,n.length,e.sampleRate);l.getChannelData(0).set(n);let s=e.createBufferSource();s.buffer=l,s.connect(e.destination),s.onended=()=>{t=t.filter(c=>c!==s)},s.start(o),t.push(s)},stop:()=>{for(let n of t)try{n.stop()}catch{}t=[]},close:()=>e.close()}}var Pe=`
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
`;var ze={title:"Ask us anything",open:"Open the support chat",close:"Close the support chat",placeholder:"Type your question",send:"Send",inputLabel:"Your question",attach:"Attach a file",removeFile:"Remove {name}",dictate:"Dictate your question",stopDictating:"Stop dictating",call:"Talk to us",endCall:"End the call",calling:"Connecting",callStarted:"Call started",callEnded:"Call ended",working:"Checking {name}",helpful:"This helped",notHelpful:"This did not help",thanks:"Thanks, that helps us improve.",copy:"Copy this answer",copied:"Copied",deleteConversation:"Delete this conversation",deleteConfirm:"Delete this conversation? It cannot be brought back.",offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status}).",submit:"Send",submitted:"Thanks, sending that now.",dismiss:"Dismiss"};function Ue(e){if(!e)return ze;let t={...ze};for(let[n,o]of Object.entries(e))typeof o=="string"&&o.trim().length>0&&(t[n]=o);return t}function me(e,t){return e.replace(/\{(\w+)\}/g,(n,o)=>o in t?String(t[o]):n)}var Dt=["recourse_q","rc_q"];function It(e={}){let t=e.params??Dt,n;try{n=new URL(e.href??window.location.href)}catch{return null}let o=null;for(let l of t){let s=n.searchParams.get(l);if(s&&s.trim()){o=s.trim().slice(0,1e3);break}}if(o===null)return null;if(e.strip!==!1){for(let l of t)n.searchParams.delete(l);try{window.history.replaceState(window.history.state,"",n.toString())}catch{}}return o}function Be(e,t={}){let n=It(t);return n===null?null:(e.open(),e.ask(n),n)}function $e(e){return`recourse:transcript:${e}`}function We(e){return`recourse:invite:${e}`}var H={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z",clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",mic:"M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",phone:"M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",hangUp:"M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"},Ot=["image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/markdown","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];function _e(e){if(!e.endpoint)throw new Error("recourse: an `endpoint` is required");let t=Ue(e.strings),n=!!e.target,o=document.createElement("div");o.setAttribute("data-recourse",""),n&&o.setAttribute("data-inline","true"),o.style.cssText=n?"display:block;width:100%;height:100%":"";let l=o.attachShadow({mode:"open"}),s=document.createElement("style");s.textContent=Pe,l.appendChild(s),e.accent&&o.style.setProperty("--rc-accent",e.accent),Ft(o,e.theme??"auto");let c=e.position==="bottom-left"?"pos-left":"pos-right",a={messages:e.persist===!1?[]:Ht(e.endpoint),busy:!1,controller:null,conversationId:`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,suggestions:e.suggestions??[],staged:[]},p={...e.actions},m=[],d=new Map;function h(r,i){for(let u of d.get(r)??[])try{u(i)}catch(g){console.error(`[recourse] listener for "${r}" threw`,g)}}let y=document.createElement("button");y.className=`launcher ${c}`,y.type="button",y.setAttribute("aria-label",t.open),y.setAttribute("aria-expanded","false"),y.appendChild(N(H.chat,!0));let b=document.createElement("div");b.className=`panel ${c}`,b.setAttribute("role","dialog"),b.setAttribute("aria-modal","false"),b.setAttribute("aria-label",e.title??t.title),b.dataset.open=String(n||e.open===!0);let f=document.createElement("div");f.className="header";let w=document.createElement("div");w.className="grow";let A=document.createElement("h2");if(A.textContent=e.title??t.title,w.appendChild(A),e.subtitle){let r=document.createElement("p");r.textContent=e.subtitle,w.appendChild(r)}f.appendChild(w);let E=document.createElement("button");E.className="icon-button",E.type="button",E.setAttribute("aria-label",t.deleteConversation),E.appendChild(N("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z",!1)),e.allowDelete&&f.appendChild(E);let P=document.createElement("button");P.className="icon-button",P.type="button",P.setAttribute("aria-label",t.close),P.appendChild(N(H.close,!1)),n||f.appendChild(P);let S=document.createElement("div");S.className="log",S.setAttribute("role","log"),S.setAttribute("aria-live","polite"),S.setAttribute("aria-relevant","additions text"),S.setAttribute("aria-live","polite"),S.setAttribute("aria-relevant","additions text");let X=document.createElement("div");X.className="suggestions";let U=document.createElement("div");U.className="error",U.hidden=!0,U.setAttribute("role","alert");let G=document.createElement("form");G.className="composer";let k=document.createElement("textarea");k.setAttribute("dir","auto"),k.rows=1,k.placeholder=t.placeholder,k.setAttribute("aria-label",t.inputLabel);let B=document.createElement("button");B.type="submit",B.setAttribute("aria-label",t.send),B.appendChild(N(H.send,!0));let D=e.attachments?{maxBytes:(typeof e.attachments=="object"?e.attachments.maxBytes:void 0)??10*1024*1024,maxCount:(typeof e.attachments=="object"?e.attachments.maxCount:void 0)??4,accept:(typeof e.attachments=="object"?e.attachments.accept:void 0)??Ot}:null,V=document.createElement("div");V.className="tray",V.hidden=!0;let I=document.createElement("input");I.type="file",I.multiple=!0,I.hidden=!0,I.tabIndex=-1;let q=document.createElement("button");q.type="button",q.className="attach",q.setAttribute("aria-label",t.attach),q.appendChild(N(H.clip,!1));let ge=e.dictation?typeof e.dictation=="object"?e.dictation:{}:null,W=document.createElement("button");W.type="button",W.className="mic",W.setAttribute("aria-label",t.dictate),W.appendChild(N(H.mic,!1));let F=null;D&&(I.accept=D.accept.join(",")),ge&&(F=Me({...ge,onStateChange:r=>{W.dataset.recording=String(r),W.setAttribute("aria-label",r?t.stopDictating:t.dictate),r||(k.dataset.interim="")},onInterim:r=>{k.value=`${k.dataset.beforeDictation??""}${r}`},onFinal:r=>{let i=k.dataset.beforeDictation??"",u=i&&!i.endsWith(" ")?`${i} ${r}`:`${i}${r}`;k.value=u,k.dataset.beforeDictation=u},onError:r=>j(r)}),F&&(W.addEventListener("click",()=>{F&&(F.recording||(k.dataset.beforeDictation=k.value),F.toggle(),k.focus())}),k.addEventListener("keydown",r=>{r.key==="Escape"&&F?.recording&&(r.preventDefault(),k.value=k.dataset.beforeDictation??"",F.cancel())})));let he=typeof e.call=="string"?e.call:e.call?e.call.endpoint:null,be=typeof e.call=="object"?e.call.load:void 0,qe=typeof e.call=="object"?e.call.transport:void 0,z=document.createElement("button");z.type="button",z.className="call",z.setAttribute("aria-label",t.call),z.appendChild(N(H.phone,!1));let te=null;if(he){let r={endpoint:he,conversationId:()=>a.conversationId,onStateChange:i=>Ke(i),onTranscript:({role:i,text:u})=>{J({role:i==="visitor"?"user":"assistant",content:u})},onError:i=>j(i)};te=qe==="hosted"?He(r):Re({...r,...be?{load:be}:{}}),z.addEventListener("click",()=>{te?.toggle()})}function Ke(r){z.dataset.state=r;let i=r==="live"||r==="connecting";z.setAttribute("aria-label",i?t.endCall:t.call),z.replaceChildren(N(i?H.hangUp:H.phone,!1)),r==="live"&&Z(t.callStarted),r==="ended"&&Z(t.callEnded)}let Ge=F?[W]:[],Je=te?[z]:[];G.append(...D?[q]:[],k,...Ge,...Je,B);let ne=document.createElement("p");ne.className="footnote",t.footnote&&(ne.textContent=t.footnote),b.append(f,S,X,U,V,G,...t.footnote?[ne]:[]),D&&b.appendChild(I),n?l.append(b):l.append(y,b),(e.target??document.body).appendChild(o),D&&(q.addEventListener("click",()=>I.click()),I.addEventListener("change",()=>{I.files&&re(I.files),I.value=""}),b.addEventListener("dragover",r=>{r.dataTransfer?.types.includes("Files")&&(r.preventDefault(),b.dataset.dropping="true")}),b.addEventListener("dragleave",()=>{delete b.dataset.dropping}),b.addEventListener("drop",r=>{r.dataTransfer?.files.length&&(r.preventDefault(),delete b.dataset.dropping,re(r.dataTransfer.files))}),k.addEventListener("paste",r=>{let i=Array.from(r.clipboardData?.files??[]);i.length!==0&&(r.preventDefault(),re(i))}));function K(r){h(r?"open":"close",{}),r&&l.querySelector(".invite")?.remove(),b.dataset.open=String(r),y.setAttribute("aria-expanded",String(r)),y.setAttribute("aria-label",r?t.close:t.open),r?k.focus():y.focus()}function j(r){U.textContent=r,U.hidden=!1}async function re(r){if(D){U.hidden=!0;for(let i of Array.from(r)){if(a.staged.length>=D.maxCount){j(`You can attach ${D.maxCount} files at a time.`);break}let u=(i.type||"").split(";")[0]?.trim().toLowerCase()??"";if(!D.accept.includes(u)){j(`${i.name} is not a file type we can read.`);continue}if(i.size>D.maxBytes){j(`${i.name} is larger than ${Math.round(D.maxBytes/1024/1024)}MB.`);continue}let g;try{g=await Pt(i)}catch{j(`${i.name} could not be read.`);continue}a.staged.push({name:i.name,mimeType:u,dataUrl:g,bytes:i.size})}oe()}}function oe(){V.replaceChildren(),V.hidden=a.staged.length===0;for(let[r,i]of a.staged.entries()){let u=document.createElement("span");u.className="chip";let g=document.createElement("span");g.textContent=i.name,u.appendChild(g);let v=document.createElement("button");v.type="button",v.setAttribute("aria-label",me(t.removeFile,{name:i.name})),v.appendChild(N(H.close,!1)),v.addEventListener("click",()=>{a.staged.splice(r,1),oe(),k.focus()}),u.appendChild(v),V.appendChild(u)}}function $(){S.scrollTop=S.scrollHeight}function Ye(r,i){let u=new Set;for(let M of i.matchAll(/\[(\d{1,2})\]/g))u.add(Number.parseInt(M[1],10)-1);let g=u.size>0?r.filter((M,T)=>u.has(T)):r,v=new Set,x=[];for(let M of g){let T=`${M.url??""}|${M.title}|${M.section??""}`;v.has(T)||(v.add(T),x.push(M))}return x}function ve(r,i){if(i.length===0)return;let u=document.createElement("div");u.className="sources";for(let g of i.slice(0,4)){let v=g.section?`${g.title} \xB7 ${g.section}`:g.title,x=document.createElement(g.url?"a":"span");x.textContent=v,g.url&&x instanceof HTMLAnchorElement&&(x.href=g.url,x.target="_blank",x.rel="noopener noreferrer"),u.appendChild(x)}r.appendChild(u)}function J(r){let i=document.createElement("div");i.className="msg",i.dataset.role=r.role;let u=document.createElement("div");return u.className="bubble",u.setAttribute("dir","auto"),r.role==="user"?u.textContent=r.content:u.appendChild(Y(r.content)),r.role==="user"&&!r.content&&r.attachments?.length?u.remove():i.appendChild(u),r.attachments?.length&&ot(i,r.attachments),r.sources&&ve(i,r.sources),S.appendChild(i),$(),{bubble:u,wrapper:i}}function ie(){if(X.replaceChildren(),a.suggestions.length!==0)for(let r of a.suggestions.slice(0,4)){let i=document.createElement("button");i.type="button",i.textContent=r,i.addEventListener("click",()=>{Q(r)}),X.appendChild(i)}}function xe(){S.replaceChildren(),e.greeting&&J({role:"assistant",content:e.greeting});for(let r of a.messages)J(r);ie()}function Xe(r){if(e.copy===!1||typeof navigator>"u"||!navigator.clipboard?.writeText)return;let i=document.createElement("button");return i.type="button",i.className="icon-button",i.setAttribute("aria-label",t.copy),i.appendChild(N("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z",!0)),i.addEventListener("click",()=>{navigator.clipboard.writeText(r).then(()=>{i.setAttribute("aria-label",t.copied),i.setAttribute("data-copied","true"),setTimeout(()=>{i.setAttribute("aria-label",t.copy),i.removeAttribute("data-copied")},1600)}).catch(()=>{})}),i}function ye(){a.messages=[],a.suggestions=e.suggestions??[],a.conversationId=`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,je(e.endpoint,[],e.persist!==!1),xe()}async function we(){let r=a.conversationId;ye();try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deleteConversation:r})})}catch{}}function Qe(r,i,u=""){let g=Xe(u);if(e.feedback===!1){if(!g)return;let x=document.createElement("div");x.className="feedback",x.appendChild(g),r.appendChild(x);return}let v=document.createElement("div");v.className="feedback";for(let[x,M,T]of[["positive",t.helpful,"M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],["negative",t.notHelpful,"M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]]){let O=document.createElement("button");O.type="button",O.className="icon-button",O.setAttribute("aria-label",M),O.appendChild(N(T,!0)),O.addEventListener("click",()=>{O.setAttribute("aria-pressed","true"),v.querySelectorAll("button").forEach(_=>{_!==O&&_.removeAttribute("aria-pressed")}),Ze(i,x)}),v.appendChild(O)}g&&v.appendChild(g),r.appendChild(v)}async function Ze(r,i){try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feedback:{conversationId:a.conversationId,messageIndex:r,value:i}})})}catch{}}async function Q(r){let i=r.trim();if(!i&&a.staged.length===0||a.busy)return;U.hidden=!0,a.busy=!0,B.disabled=!0,F?.recording&&F.cancel(),k.dataset.beforeDictation="";let u=a.staged;a.staged=[],oe();let g={role:"user",content:i};u.length>0&&(g.attachments=u),a.messages.push(g),J(g),h("message",{text:i}),a.suggestions=[],ie(),a.controller=new AbortController,await ae(void 0,u),a.busy=!1,B.disabled=!1,a.controller=null,$(),k.focus()}async function ae(r,i){let{bubble:u,wrapper:g}=J({role:"assistant",content:""});S.setAttribute("aria-busy","true");let v=document.createElement("span");v.className="typing",v.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),u.appendChild(v);let x=null,M=L=>{if(!T.content){if(!L){x?.remove(),x=null,u.contains(v)||u.appendChild(v);return}v.remove(),x??(x=document.createElement("div")),x.className="working",x.textContent=me(t.working,{name:L}),u.contains(x)||u.appendChild(x),$()}},T={role:"assistant",content:""},O=[],_=[];if(await Le(e.endpoint,{messages:a.messages,conversationId:a.conversationId,userId:e.userId,userHash:e.userHash,contact:e.contact,actionResults:r,...i&&i.length>0?{attachments:i}:{}},{onSources:L=>{O=L},onDelta:L=>{v.remove(),x?.remove(),x=null,T.content+=L,u.replaceChildren(Y(T.content)),$()},onError:L=>{v.remove(),x?.remove(),x=null,j(L),h("error",{message:L})},onFrame:L=>tt(L,_,M)},a.controller?.signal,t).finally(()=>{v.remove(),S.setAttribute("aria-busy","false")}),_.length>0&&!r){g.remove();let L=_.find(le=>le.payload?.form);if(L){se={name:L.name,input:L.input};let le=Ae(L.payload?.form,ke),ee=document.createElement("div");ee.className="msg",ee.dataset.role="assistant",ee.appendChild(le),S.appendChild(ee),$();return}let at=await rt(_);await ae(at);return}T.content.trim()?(T.sources=Ye(O,T.content),a.messages.push(T),ve(g,T.sources),Qe(g,a.messages.length-1,T.content),je(e.endpoint,a.messages,e.persist!==!1),h("response",{text:T.content,sources:T.sources})):g.remove(),ie()}function et(r){return r.replace(/[_-]+/g," ").trim()}function tt(r,i,u=()=>{}){if(r.type==="client-action")i.push({id:r.id,name:r.name,input:r.input,payload:r.payload});else if(r.type==="suggestions")a.suggestions=r.items;else if(r.type==="action")h("action",{name:r.name,status:r.status}),u(r.status==="running"?r.summary??et(r.name):null);else if(r.type==="captured")h("captured",{kind:r.kind,name:r.name,values:r.values});else if(r.type==="notice")Z(r.message);else if(r.type==="handoff")h("handoff",{ticketId:r.ticketId,message:r.message}),Z(r.message);else if(r.type==="ui"){let g=Te({kind:r.kind,id:r.id,data:r.data},ke);if(g){let v=r.id?[...S.children].find(M=>M.dataset?.uiId===r.id):void 0,x=document.createElement("div");x.className="msg",x.dataset.role="assistant",r.id&&(x.dataset.uiId=r.id),x.appendChild(g),v?v.replaceWith(x):(S.appendChild(x),$())}}}let ke={submit:r=>{Q(r)},respond:r=>{nt(r)},run:async(r,i)=>{let u=p[r];if(!u)throw new Error("That is not available here");return u(i)}},se=null;async function nt(r){let i=se;se=null,!(!i||a.busy)&&(a.busy=!0,B.disabled=!0,a.controller=new AbortController,await ae([{name:i.name,input:i.input,output:r}]),a.busy=!1,B.disabled=!1,a.controller=null)}async function rt(r){return Promise.all(r.map(async i=>{let u=p[i.name];if(!u)return{name:i.name,input:i.input,output:{error:"no handler registered on this page"}};try{return{name:i.name,input:i.input,output:await u(i.input)}}catch(g){return{name:i.name,input:i.input,output:{error:g instanceof Error?g.message:String(g)}}}}))}function ot(r,i){let u=document.createElement("div");u.className="attached";for(let g of i){if(g.mimeType.startsWith("image/")){let x=document.createElement("img");x.src=g.dataUrl,x.alt=g.name,u.appendChild(x);continue}let v=document.createElement("span");v.className="chip",v.textContent=g.name,u.appendChild(v)}r.appendChild(u)}function Z(r){let i=document.createElement("div");i.className="notice",i.textContent=r,S.appendChild(i),$()}function it(){if(n||!e.invite||b.dataset.open==="true")return;try{if(sessionStorage.getItem(We(e.endpoint)))return}catch{}let r=document.createElement("div");r.className=`invite ${c}`,r.setAttribute("role","button"),r.tabIndex=0,r.appendChild(document.createTextNode(e.invite));let i=document.createElement("button");i.type="button",i.className="invite-dismiss",i.setAttribute("aria-label",t.dismiss),i.appendChild(N(H.close,!1));let u=()=>{r.remove();try{sessionStorage.setItem(We(e.endpoint),"1")}catch{}};i.addEventListener("click",v=>{v.stopPropagation(),u()});let g=()=>{u(),K(!0)};r.addEventListener("click",g),r.addEventListener("keydown",v=>{(v.key==="Enter"||v.key===" ")&&(v.preventDefault(),g())}),r.appendChild(i),l.appendChild(r)}if(e.invite&&!n){let r=e.inviteDelay??4e3,i=setTimeout(it,r);m.push(i)}y.addEventListener("click",()=>K(b.dataset.open!=="true")),P.addEventListener("click",()=>K(!1)),E.addEventListener("click",()=>{typeof window.confirm=="function"&&!window.confirm(t.deleteConfirm)||we()}),G.addEventListener("submit",r=>{r.preventDefault();let i=k.value;k.value="",k.style.height="auto",Q(i)}),k.addEventListener("input",()=>{k.style.height="auto",k.style.height=`${k.scrollHeight}px`}),k.addEventListener("keydown",r=>{r.key==="Enter"&&!r.shiftKey&&(r.preventDefault(),G.requestSubmit())}),l.addEventListener("keydown",r=>{r.key==="Escape"&&!n&&K(!1)}),xe();let Ce={open:()=>K(!0),close:()=>K(!1),ask:Q,on(r,i){let u=d.get(r)??new Set;return u.add(i),d.set(r,u),()=>u.delete(i)},handle(r,i){p[r]=i},clear(){ye()},forget:()=>we(),destroy(){a.controller?.abort();for(let r of m)clearTimeout(r);o.remove()},element:o};return e.deepLink!==!1&&Be(Ce),Ce}function Ft(e,t){if(t!=="auto"){e.setAttribute("data-theme",t);return}let n=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>e.setAttribute("data-theme",n.matches?"dark":"light");o(),n.addEventListener("change",o)}function N(e,t){let n=document.createElementNS("http://www.w3.org/2000/svg","svg");n.setAttribute("viewBox","0 0 24 24"),n.setAttribute("aria-hidden","true"),n.setAttribute("fill",t?"currentColor":"none"),n.setAttribute("stroke",t?"none":"currentColor"),n.setAttribute("stroke-width","2"),n.setAttribute("stroke-linecap","round");let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",e),n.appendChild(o),n}function Ht(e){try{let t=sessionStorage.getItem($e(e));return t?JSON.parse(t):[]}catch{return[]}}function je(e,t,n){if(n)try{sessionStorage.setItem($e(e),JSON.stringify(t.slice(-20)))}catch{}}function Pt(e){return new Promise((t,n)=>{let o=new FileReader;o.onload=()=>t(String(o.result)),o.onerror=()=>n(new Error("unreadable")),o.readAsDataURL(e)})}function zt(){let t=document.currentScript?.dataset??{},n=t.endpoint??window.recourseConfig?.endpoint;if(!n)return console.warn("[recourse] no data-endpoint on the script tag, widget not mounted"),null;let o=t.target?document.querySelector(t.target):null;return{endpoint:n,userId:t.userId,userHash:t.userHash,feedback:t.feedback!=="false",invite:t.invite,inviteDelay:t.inviteDelay?Number(t.inviteDelay):void 0,title:t.title,subtitle:t.subtitle,...t.footnote?{strings:{footnote:t.footnote}}:{},greeting:t.greeting,accent:t.accent,suggestions:t.suggestions?.split("|").map(l=>l.trim()).filter(Boolean),position:t.position==="bottom-left"?"bottom-left":"bottom-right",theme:t.theme==="dark"||t.theme==="light"?t.theme:"auto",open:t.open==="true",persist:t.persist!=="false",deepLink:t.deepLink!=="false",...Ut(t.attachments),...t.dictation==="true"?{dictation:{...t.dictationLang?{lang:t.dictationLang}:{},...t.dictationCloud==="true"?{allowCloudFallback:!0}:{}}}:{},...t.call?{call:t.callTransport==="hosted"?{endpoint:t.call,transport:"hosted"}:t.call}:{},copy:t.copy!=="false",allowDelete:t.delete==="true",...window.recourseConfig,...o?{target:o}:{}}}function Ut(e){if(!e||e==="false")return{};if(e==="true")return{attachments:!0};let t=Number(e);return Number.isFinite(t)&&t>0?{attachments:{maxBytes:Math.round(t*1024*1024)}}:{}}var Ve=zt();if(Ve){let e=()=>{window.recourse=_e(Ve)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e()}})();
