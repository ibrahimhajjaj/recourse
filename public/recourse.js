"use strict";(()=>{var wt=/(\*\*[^*]+\*\*|`[^`]+`|!?\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,kt=/^(https?:|mailto:|\/|#)/i;function oe(e){let t=document.createDocumentFragment();for(let r of Ct(e))t.appendChild(Et(r));return t}function Ct(e){let t=[],r=null,o=null,s=()=>{r&&r.lines.length>0&&t.push(r),r=null};for(let l of e.split(`
`)){if(/^\s*(```|~~~)/.test(l)){o?(t.push(o),o=null):(s(),o={kind:"code",lines:[]});continue}if(o){o.lines.push(l);continue}if(l.trim()===""){s();continue}let c=/^\s*[-*+]\s+(.*)$/.exec(l),a=/^\s*\d+[.)]\s+(.*)$/.exec(l),p=c?"ul":a?"ol":"p",f=c?.[1]??a?.[1]??l;(!r||r.kind!==p)&&(s(),r={kind:p,lines:[]}),r.lines.push(f)}return o&&t.push(o),s(),t}function Et(e){if(e.kind==="code"){let r=document.createElement("pre"),o=document.createElement("code");return o.textContent=e.lines.join(`
`),r.appendChild(o),r}if(e.kind==="ul"||e.kind==="ol"){let r=document.createElement(e.kind);for(let o of e.lines){let s=document.createElement("li");s.appendChild(Fe(o)),r.appendChild(s)}return r}let t=document.createElement("p");return t.appendChild(Fe(e.lines.join(" "))),t}function Fe(e){let t=document.createDocumentFragment();for(let r of e.split(wt)){if(!r)continue;if(r.startsWith("**")&&r.endsWith("**")){t.appendChild(ke("strong",r.slice(2,-2)));continue}if(r.startsWith("`")&&r.endsWith("`")){t.appendChild(ke("code",r.slice(1,-1)));continue}if(r.startsWith("*")&&r.endsWith("*")&&r.length>2){t.appendChild(ke("em",r.slice(1,-1)));continue}let o=/^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(r);if(o){let l=o[2];if(/^https:/i.test(l)){let c=document.createElement("img");c.src=l,c.alt=o[1],c.loading="lazy",c.className="md-image",t.appendChild(c)}else t.appendChild(document.createTextNode(o[1]));continue}let s=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(r);if(s){let l=s[2];if(kt.test(l)){let c=document.createElement("a");c.textContent=s[1],c.href=l,c.target="_blank",c.rel="noopener noreferrer",t.appendChild(c)}else t.appendChild(document.createTextNode(s[1]));continue}t.appendChild(document.createTextNode(r))}return t}function ke(e,t){let r=document.createElement(e);return r.textContent=t,r}var Ee=/^(https?:|mailto:|tel:|\/|#)/i;function Ce(e,t){let r=e.showIf;if(r===void 0)return!0;if(typeof r=="boolean")return r;if(typeof r=="string"){let o=r.startsWith("!"),s=o?r.slice(1):r,[l,c]=s.split("=",2),a=t[(l??"").trim()],p=c===void 0?!!a:String(a)===c.trim();return o?!p:p}return!0}function I(e,t,r){let o=document.createElement(e);return o.textContent=t,r&&(o.className=r),o}function E(e){return typeof e=="string"?e:e==null?"":String(e)}function He(e,t,r,o=!1){if(!Ee.test(t))return I("span",e,r);let s=document.createElement("a");return s.textContent=e,s.href=t,o||(s.target="_blank"),s.rel="noopener noreferrer",s.className=r,s}var St=e=>{let t=E(e.label)||"Open",r=E(e.url);if(!r)return null;let o=document.createElement("div");return o.className="ui-actions",o.appendChild(He(t,r,"ui-button",e.sameTab===!0)),o};function At(e,t){let r=E(e.label);if(!r)return null;if(e.url)return He(r,E(e.url),"ui-button");let o=document.createElement("button");return o.type="button",o.className="ui-button",o.textContent=r,e.run?(o.addEventListener("click",async()=>{if(t.run){o.disabled=!0;try{await t.run(E(e.run),e.payload??{}),o.replaceWith(I("span",E(e.done)||"Done","ui-muted"))}catch(s){o.disabled=!1,o.textContent=s instanceof Error?s.message:"That did not work"}}}),o):(o.addEventListener("click",()=>t.submit(E(e.send)||r)),o)}var Tt=(e,t)=>{let r=document.createElement("div");if(r.className="ui-card",e.image&&Ee.test(E(e.image))){let c=document.createElement("img");c.src=E(e.image),c.alt=E(e.title),c.loading="lazy",c.className="ui-card-image",r.appendChild(c)}let o=document.createElement("div");o.className="ui-card-body",e.title&&o.appendChild(I("h3",E(e.title))),e.subtitle&&o.appendChild(I("p",E(e.subtitle),"ui-muted"));let s=(Array.isArray(e.fields)?e.fields:[]).filter(c=>Ce(c,e));if(s.length>0){let c=document.createElement("dl");c.className="ui-fields";for(let a of s){let p=a;c.appendChild(I("dt",E(p.label))),c.appendChild(I("dd",E(p.value)))}o.appendChild(c)}let l=(Array.isArray(e.actions)?e.actions:[]).filter(c=>Ce(c,e));if(l.length>0){let c=document.createElement("div");c.className="ui-actions";for(let a of l){let p=At(a,t);p&&c.appendChild(p)}c.childElementCount>0&&o.appendChild(c)}return r.appendChild(o),r},Mt=e=>{let t=(Array.isArray(e.columns)?e.columns:[]).map(E),r=Array.isArray(e.rows)?e.rows:[];if(t.length===0||r.length===0)return null;let o=document.createElement("div");o.className="ui-table-wrap";let s=document.createElement("table");s.className="ui-table";let l=document.createElement("thead"),c=document.createElement("tr");for(let p of t)c.appendChild(I("th",p));l.appendChild(c),s.appendChild(l);let a=document.createElement("tbody");for(let p of r.slice(0,25)){let f=document.createElement("tr"),u=Array.isArray(p)?p:t.map(b=>p[b]);for(let b of u)f.appendChild(I("td",E(b)));a.appendChild(f)}return s.appendChild(a),o.appendChild(s),o},Lt=(e,t)=>{let r=(Array.isArray(e.items)?e.items:[]).filter(s=>Ce(s,e));if(r.length===0)return null;let o=document.createElement("div");o.className="ui-list";for(let s of r){let l=s,c=E(l.title);if(!c)continue;let a=document.createElement(l.url?"a":"button");a.className="ui-list-item",a instanceof HTMLAnchorElement&&Ee.test(E(l.url))?(a.href=E(l.url),a.target="_blank",a.rel="noopener noreferrer"):a instanceof HTMLButtonElement&&(a.type="button",a.addEventListener("click",()=>t.submit(E(l.send)||c))),a.appendChild(I("span",c,"ui-list-title")),l.subtitle&&a.appendChild(I("span",E(l.subtitle),"ui-muted")),o.appendChild(a)}return o.childElementCount>0?o:null};function ze(e,t){let r=document.createElement("form");r.className="ui-form",e.title&&r.appendChild(I("h3",e.title));let o=Array.isArray(e.fields)?e.fields:[],s=[];for(let a of o){let p=a,f=E(p.name);if(!f)continue;let u=document.createElement("label");u.className="ui-field",u.appendChild(I("span",E(p.label)||f));let b;if(Array.isArray(p.options)&&p.options.length>0){let x=document.createElement("select");for(let v of p.options){let m=document.createElement("option");m.value=E(v),m.textContent=E(v),x.appendChild(m)}b=x}else if(p.type==="boolean"){let x=document.createElement("input");x.type="checkbox",b=x}else{let x=document.createElement("input");x.type=p.type==="number"?"number":"text",p.placeholder&&(x.placeholder=E(p.placeholder)),b=x}b.name=f,p.required!==!1&&b instanceof HTMLInputElement&&b.type!=="checkbox"&&(b.required=!0),u.appendChild(b),r.appendChild(u),s.push({name:f,element:b})}let l=document.createElement("button");l.type="submit",l.className="ui-button",l.textContent=e.submitLabel||"Send",r.appendChild(l);let c=!1;return r.addEventListener("submit",a=>{if(a.preventDefault(),c)return;c=!0;let p={};for(let{name:f,element:u}of s)p[f]=u instanceof HTMLInputElement&&u.type==="checkbox"?u.checked:u.value;r.replaceChildren(oe("Thanks, sending that now.")),t.respond(p)}),r}var Rt={button:St,card:Tt,table:Mt,list:Lt};function Ue(e,t){let r=Rt[e.kind];return r?r(e.data,t):null}var Nt={offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status})."};async function We(e,t,r,o,s=Nt){let l;try{l=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,messages:t.messages.map(f=>({role:f.role,content:f.content}))}),signal:o})}catch{r.onError?.(s.offline);return}if(!l.ok||!l.body){r.onError?.(l.status===429?s.rateLimited:s.unavailable.replace("{status}",String(l.status)));return}let c=l.body.getReader(),a=new TextDecoder,p="";for(;;){let{done:f,value:u}=await c.read();if(f)break;p+=a.decode(u,{stream:!0});let b=p.split(`

`);p=b.pop()??"";for(let x of b){let v=x.split(`
`).find(k=>k.startsWith("data:"));if(!v)continue;let m;try{m=JSON.parse(v.slice(5).trim())}catch{continue}r.onFrame?.(m),m.type==="sources"?r.onSources?.(m.sources):m.type==="delta"?r.onDelta?.(m.text):m.type==="done"?r.onDone?.():m.type==="error"&&r.onError?.(m.message)}}r.onDone?.()}function Ot(e=globalThis){let t=e;return t.SpeechRecognition??t.webkitSpeechRecognition??null}var Dt={"not-allowed":"I need permission to use the microphone. You can allow it in your browser settings.","service-not-allowed":"Your browser would not let me use speech recognition.","no-speech":"I did not hear anything. Try again?","audio-capture":"I could not find a microphone.",network:"Speech recognition needs a connection and could not reach it.","language-not-supported":"Speech recognition is not available for this language on your device."};function Be(e={},t=globalThis){let r=Ot(t);if(!r)return null;let o=r,s=null,l=!1;function c(f){let u=new o;u.continuous=!0,u.interimResults=!0,u.maxAlternatives=1;let b=e.lang??It(t);return b&&(u.lang=b),f&&(u.processLocally=!0),u}function a(f){f.onstart=()=>e.onStateChange?.(!0),f.onresult=u=>{let b="";for(let x=u.resultIndex;x<u.results.length;x++){let v=u.results[x];if(!v)continue;let m=v[0]?.transcript??"";v.isFinal?e.onFinal?.(m):b+=m}b&&e.onInterim?.(b)},f.onerror=u=>{let b=e.processLocally!==!1,x=u.error==="language-not-supported"||u.error==="service-not-allowed";if(b&&x&&e.allowCloudFallback&&!l){l=!0,s=null,p(!1);return}u.error!=="aborted"&&e.onError?.(Dt[u.error]??"Speech recognition stopped unexpectedly.")},f.onend=()=>{s=null,e.onStateChange?.(!1)}}function p(f){let u=c(f);a(u),s=u;try{u.start()}catch{s=null,e.onStateChange?.(!1)}}return{get recording(){return s!==null},start(){s||(l=!1,p(e.processLocally!==!1))},stop(){s?.stop()},cancel(){let f=s;s=null,f?.abort(),e.onStateChange?.(!1)},toggle(){s?this.stop():this.start()}}}function It(e){return e.document?.documentElement?.lang??""}function je(e){let t=e.fetch??globalThis.fetch.bind(globalThis),r=e.load??Ft,o="idle",s=null,l=0,c=u=>{o!==u&&(o=u,e.onStateChange?.(u))},a=u=>{c("failed"),e.onError?.(u)};async function p(){if(o==="connecting"||o==="live")return;let u=++l;c("connecting");let b;try{let v=await t(e.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:e.conversationId()})});if(v.status===429){u===l&&a("Too many calls just now. Try again in a moment.");return}if(!v.ok){u===l&&a("Calling is not available right now.");return}let m=await v.json();if(typeof m.signedUrl!="string"||!m.signedUrl){u===l&&a("Calling is not available right now.");return}b=m.signedUrl}catch{u===l&&a("Could not reach the server to start the call.");return}if(u!==l)return;let x;try{x=await r()}catch{u===l&&a("Could not load the voice connection.");return}if(u===l)try{let v=await x.startSession({signedUrl:b,onConnect:()=>{u===l&&c("live")},onDisconnect:()=>{u===l&&(s=null,c("ended"))},onError:()=>{u===l&&a("The call ended unexpectedly. Your microphone may be blocked.")},onMessage:m=>{let k=typeof m?.message=="string"?m.message.trim():"";k&&e.onTranscript?.({role:m.source==="user"?"visitor":"agent",text:k})}});if(u!==l){await Promise.resolve(v.endSession()).catch(()=>{});return}s=v}catch{u===l&&a("Could not start the call. Your microphone may be blocked.")}}async function f(){l++;let u=s;if(s=null,u)try{await u.endSession()}catch{}c(o==="failed"?"failed":"ended")}return{get state(){return o},start:p,stop:f,async toggle(){o==="connecting"||o==="live"?await f():await p()}}}var Pt="https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";async function Ft(){let t=await import(Pt);if(!t.Conversation)throw new Error("no conversation runtime in the loaded module");return t.Conversation}function $e(e,t,r=16e3){if(r>=t||e.length===0)return e;let o=t/r,s=new Float32Array(Math.floor(e.length/o));for(let l=0;l<s.length;l++){let c=Math.floor(l*o),a=Math.min(e.length,Math.floor((l+1)*o)),p=0;for(let f=c;f<a;f++)p+=e[f];s[l]=a>c?p/(a-c):0}return s}function _e(e){let t=new Int16Array(e.length);for(let r=0;r<e.length;r++){let o=Math.max(-1,Math.min(1,e[r]));t[r]=o<0?o*32768:o*32767}return t}function Ve(e){if(e.length===0)return 0;let t=0;for(let r of e)t+=r*r;return Math.min(1,Math.sqrt(t/e.length)/32768)}var zt=`
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
`,Ut={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:1},Wt=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"];function Se(){let e=globalThis.MediaRecorder;return e?.isTypeSupported?Wt.find(t=>e.isTypeSupported?.(t))??null:null}async function qe(e){let t=e.frameMs??20,{context:r,stream:o}=await(e.open??jt)(),s=Math.round(r.sampleRate*t/1e3),l=r.createMediaStreamSource(o),c=URL.createObjectURL(new Blob([zt],{type:"application/javascript"}));try{await r.audioWorklet.addModule(c)}finally{URL.revokeObjectURL(c)}let a=new AudioWorkletNode(r,"recourse-capture",{numberOfInputs:1,numberOfOutputs:0,processorOptions:{frameSamples:s}});a.port.onmessage=f=>{let u=$e(f.data,r.sampleRate,16e3);e.onFrame(_e(u))},l.connect(a);let p=null;if(e.onCompressed){let f=Se();if(f){let u=!0;p=(e.record??Bt)(o,f,e.chunkMs??200,b=>{let x=u;u=!1,b.size!==0&&b.arrayBuffer().then(v=>e.onCompressed?.(v,x))})}}return{async stop(){a.port.onmessage=null,p?.stop(),l.disconnect(),a.disconnect();for(let f of o.getTracks())f.stop();await r.close()}}}function Bt(e,t,r,o){let s=new MediaRecorder(e,{mimeType:t});return s.ondataavailable=l=>o(l.data),s.start(r),{stop:()=>{try{s.state!=="inactive"&&s.stop()}catch{}}}}async function jt(){let e=await navigator.mediaDevices.getUserMedia({audio:Ut});return{context:new AudioContext,stream:e}}function Ke(e){let t=e.cushionSeconds??.05,r=0;return{get endsAt(){return r},get playing(){return r>e.now()},push(o){if(o.length===0)return;let s=e.now(),l=r>s?r:s+t;e.play(o,l),r=l+o.length/e.sampleRate},clear(){r=0}}}function Ge(e){let t="idle",r=null,o=null,s=null,l=null,c=0,a=m=>{t!==m&&(t=m,e.onStateChange?.(m))},p=m=>{a("failed"),e.onError?.(m)};async function f(){let m=o,k=s,A=r;o=null,s=null,l=null,r=null;try{A?.close()}catch{}await m?.stop().catch(()=>{}),k?.stop(),await k?.close().catch(()=>{})}async function u(){if(t==="connecting"||t==="live")return;let m=++c;a("connecting");let k;try{k=(e.connect??_t)($t(e.endpoint))}catch{m===c&&p("Could not reach the server to start the call.");return}k.binaryType="arraybuffer",r=k,k.onopen=()=>{if(m!==c){k.close();return}let A=e.compress===!1?null:Se();k.send(JSON.stringify({type:"hello",sampleRate:16e3,conversationId:e.conversationId(),...A?{audio:{mimeType:A}}:{}})),b(m,k,A)},k.onmessage=A=>{if(m===c){if(typeof A.data=="string"){let T;try{T=JSON.parse(A.data)}catch{return}T.type==="transcript"&&T.text&&T.role&&e.onTranscript?.({role:T.role,text:T.text}),T.type==="interrupted"&&(s?.stop(),l?.clear()),T.type==="error"&&e.onError?.(T.message??"Something went wrong.");return}A.data instanceof ArrayBuffer&&x(m,A.data)}},k.onerror=()=>{m===c&&(f(),p("The call was cut off."))},k.onclose=()=>{m===c&&(f(),(t==="live"||t==="connecting")&&a("ended"))}}async function b(m,k,A){try{s=(e.audio??Vt)(),l=Ke({now:s.now,play:s.play,sampleRate:s.sampleRate});let T=[],_=()=>{T.length===0||!Ae(k)||(k.send(JSON.stringify({type:"levels",values:T,frameMs:20})),T=[])};if(o=await(e.microphone??qe)({onFrame:P=>{if(!(m!==c||!Ae(k))){if(A){T.push(Ve(P)),T.length>=5&&_();return}k.send(P)}},...A?{onCompressed:P=>{m!==c||!Ae(k)||(_(),k.send(P))}}:{}}),m!==c){await f();return}a("live")}catch{if(m!==c)return;await f(),p("Could not use your microphone. It may be blocked for this site.")}}async function x(m,k){try{let A=await s?.decode(k);if(m!==c||!A)return;l?.push(A)}catch{}}async function v(){c++,await f(),a(t==="failed"?"failed":"ended")}return{get state(){return t},start:u,stop:v,async toggle(){t==="connecting"||t==="live"?await v():await u()}}}function Ae(e){return e.readyState===1||e.readyState==="open"}function $t(e){if(/^wss?:\/\//i.test(e))return e;let t=new URL(e,location.href);return t.protocol=t.protocol==="https:"?"wss:":"ws:",t.toString()}function _t(e){return new WebSocket(e)}function Vt(){let e=new AudioContext,t=[];return{sampleRate:e.sampleRate,now:()=>e.currentTime,decode:async r=>(await e.decodeAudioData(r)).getChannelData(0),play:(r,o)=>{let s=e.createBuffer(1,r.length,e.sampleRate);s.getChannelData(0).set(r);let l=e.createBufferSource();l.buffer=s,l.connect(e.destination),l.onended=()=>{t=t.filter(c=>c!==l)},l.start(o),t.push(l)},stop:()=>{for(let r of t)try{r.stop()}catch{}t=[]},close:()=>e.close()}}var Je=`
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
.md-image { display: block; max-width: 100%; height: auto; border-radius: 8px; margin: 6px 0; }
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
`;var Ye={title:"Ask us anything",open:"Open the support chat",close:"Close the support chat",placeholder:"Type your question",choosePlaceholder:"Choose one of the options above",send:"Send",inputLabel:"Your question",attach:"Attach a file",removeFile:"Remove {name}",dictate:"Dictate your question",stopDictating:"Stop dictating",listening:"Listening, press again to stop",call:"Talk to us",endCall:"End the call",calling:"Connecting, this can take a few seconds",onCall:"On a call \xB7 {time}",callAgain:"Call again, the last call failed",callStarted:"Call started",callEnded:"Call ended",working:"Checking {name}",helpful:"This helped",notHelpful:"This did not help",thanks:"Thanks, that helps us improve.",copy:"Copy this answer",copied:"Copied",deleteConversation:"Delete this conversation",deleteConfirm:"Delete this conversation? It cannot be brought back.",offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status}).",submit:"Send",submitted:"Thanks, sending that now.",dismiss:"Dismiss"};function Xe(e){if(!e)return Ye;let t={...Ye};for(let[r,o]of Object.entries(e))typeof o=="string"&&o.trim().length>0&&(t[r]=o);return t}function ue(e,t){return e.replace(/\{(\w+)\}/g,(r,o)=>o in t?String(t[o]):r)}var qt=["recourse_q","rc_q"];function Kt(e={}){let t=e.params??qt,r;try{r=new URL(e.href??window.location.href)}catch{return null}let o=null;for(let s of t){let l=r.searchParams.get(s);if(l&&l.trim()){o=l.trim().slice(0,1e3);break}}if(o===null)return null;if(e.strip!==!1){for(let s of t)r.searchParams.delete(s);try{window.history.replaceState(window.history.state,"",r.toString())}catch{}}return o}function Qe(e,t={}){let r=Kt(t);return r===null?null:(e.open(),e.ask(r),r)}function tt(e){return`recourse:transcript:${e}`}function Ze(e){return`recourse:invite:${e}`}var W={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z",clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",mic:"M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",phone:"M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",hangUp:"M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"},Gt=["image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/markdown","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];function nt(e){if(!e.endpoint)throw new Error("recourse: an `endpoint` is required");let t=Xe(e.strings),r=!!e.target,o=document.createElement("div");o.setAttribute("data-recourse",""),r&&o.setAttribute("data-inline","true"),o.style.cssText=r?"display:block;width:100%;height:100%":"";let s=o.attachShadow({mode:"open"}),l=document.createElement("style");l.textContent=Je,s.appendChild(l),e.accent&&o.style.setProperty("--rc-accent",e.accent),Jt(o,e.theme??"auto");let c=e.position==="bottom-left"?"pos-left":"pos-right",a={messages:e.persist===!1?[]:Xt(e.endpoint),busy:!1,controller:null,conversationId:`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,suggestions:[...e.suggestions??[]],pickOne:!1,staged:[]},p={...e.actions},f=[],u=new Map;function b(n,i){for(let d of u.get(n)??[])try{d(i)}catch(h){console.error(`[recourse] listener for "${n}" threw`,h)}}let x=document.createElement("button");x.className=`launcher ${c}`,x.type="button",x.setAttribute("aria-label",t.open),x.setAttribute("aria-expanded","false"),x.appendChild(D(W.chat,!0));let v=document.createElement("div");v.className=`panel ${c}`,v.setAttribute("role","dialog"),v.setAttribute("aria-modal","false"),v.setAttribute("aria-label",e.title??t.title),v.dataset.open=String(r||e.open===!0);let m=document.createElement("div");m.className="header";let k=document.createElement("div");k.className="grow";let A=document.createElement("h2");k.appendChild(A);let T=document.createElement("p");k.appendChild(T),m.appendChild(k);let _=document.createElement("button");_.className="icon-button",_.type="button",_.setAttribute("aria-label",t.deleteConversation),_.appendChild(D("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z",!1)),e.allowDelete&&m.appendChild(_);let P=document.createElement("button");P.className="icon-button",P.type="button",P.setAttribute("aria-label",t.close),P.appendChild(D(W.close,!1)),r||m.appendChild(P);let M=document.createElement("div");M.className="log",M.setAttribute("role","log"),M.setAttribute("aria-live","polite"),M.setAttribute("aria-relevant","additions text"),M.setAttribute("aria-live","polite"),M.setAttribute("aria-relevant","additions text");let ie=document.createElement("div");ie.className="suggestions";let q=document.createElement("div");q.className="error",q.hidden=!0,q.setAttribute("role","alert");let ee=document.createElement("form");ee.className="composer";let w=document.createElement("textarea");w.setAttribute("dir","auto"),w.rows=1,w.placeholder=t.placeholder,w.setAttribute("aria-label",t.inputLabel);let te=document.createElement("button");te.type="submit",te.setAttribute("aria-label",t.send),te.appendChild(D(W.send,!0));let F=e.attachments?{maxBytes:(typeof e.attachments=="object"?e.attachments.maxBytes:void 0)??10*1024*1024,maxCount:(typeof e.attachments=="object"?e.attachments.maxCount:void 0)??4,accept:(typeof e.attachments=="object"?e.attachments.accept:void 0)??Gt}:null,Y=document.createElement("div");Y.className="tray",Y.hidden=!0;let H=document.createElement("input");H.type="file",H.multiple=!0,H.hidden=!0,H.tabIndex=-1;let X=document.createElement("button");X.type="button",X.className="attach",X.setAttribute("aria-label",t.attach),X.appendChild(D(W.clip,!1));let Te=e.dictation?typeof e.dictation=="object"?e.dictation:{}:null,B=document.createElement("button");B.type="button",B.className="mic",B.setAttribute("aria-label",t.dictate),B.appendChild(D(W.mic,!1));let z=null,Me=!1,Le;F&&(H.accept=F.accept.join(",")),Te&&(z=Be({...Te,onStateChange:n=>{B.dataset.recording=String(n),B.setAttribute("aria-label",n?t.stopDictating:t.dictate),B.setAttribute("aria-pressed",String(n)),B.replaceChildren(n?Object.assign(document.createElement("span"),{className:"stop"}):D(W.mic,!1)),n?ne("listening",t.listening):Me||ne(null),n||(w.dataset.interim="")},onInterim:n=>{w.value=`${w.dataset.beforeDictation??""}${n}`},onFinal:n=>{let i=w.dataset.beforeDictation??"",d=i&&!i.endsWith(" ")?`${i} ${n}`:`${i}${n}`;w.value=d,w.dataset.beforeDictation=d},onError:n=>G(n)}),z&&(B.addEventListener("click",()=>{z&&(z.recording||(w.dataset.beforeDictation=w.value),z.toggle(),w.focus())}),w.addEventListener("keydown",n=>{n.key==="Escape"&&z?.recording&&(n.preventDefault(),w.value=w.dataset.beforeDictation??"",z.cancel())})));let Re=typeof e.call=="string"?e.call:e.call?e.call.endpoint:null,Ne=typeof e.call=="object"?e.call.load:void 0,ot=typeof e.call=="object"?e.call.transport:void 0,j=document.createElement("button");j.type="button",j.className="call",j.setAttribute("aria-label",t.call),j.appendChild(D(W.phone,!1));let pe=null;if(Re){let n={endpoint:Re,conversationId:()=>a.conversationId,onStateChange:i=>it(i),onTranscript:({role:i,text:d})=>{re({role:i==="visitor"?"user":"assistant",content:d})},onError:i=>G(i)};pe=ot==="hosted"?Ge(n):je({...n,...Ne?{load:Ne}:{}}),j.addEventListener("click",()=>{pe?.toggle()})}function it(n){j.dataset.state=n;let i=n==="live"||n==="connecting",d=n==="failed";if(j.setAttribute("aria-label",i?t.endCall:d?t.callAgain:t.call),j.replaceChildren(D(i?W.hangUp:W.phone,!1)),d&&j.appendChild(Object.assign(document.createElement("span"),{className:"failed"})),clearInterval(Le),n==="live"){let h=Date.now(),g=()=>ne("live",ue(t.onCall,{time:Yt(h)}));g(),Le=setInterval(g,1e3)}else n==="connecting"?ne("connecting",t.calling):z?.recording||ne(null);Me=i,n==="live"&&ce(t.callStarted),n==="ended"&&ce(t.callEnded)}let at=z?[B]:[],st=pe?[j]:[];ee.append(...F?[X]:[],w,...at,...st,te);let ae=document.createElement("p");ae.className="footnote";let $=document.createElement("p");$.className="status",$.setAttribute("role","status"),$.setAttribute("aria-live","polite"),$.hidden=!0,$.append(Object.assign(document.createElement("span"),{className:"dot"}));let me=document.createElement("span");$.appendChild(me);function ne(n,i=""){if($.hidden=n===null,n===null){me.textContent="",$.removeAttribute("data-kind");return}$.dataset.kind=n,me.textContent=i}v.append(m,M,ie,q,Y,ee,$,ae),F&&v.appendChild(H),r?s.append(v):s.append(x,v),(e.target??document.body).appendChild(o),F&&(X.addEventListener("click",()=>H.click()),H.addEventListener("change",()=>{H.files&&ge(H.files),H.value=""}),v.addEventListener("dragover",n=>{n.dataTransfer?.types.includes("Files")&&(n.preventDefault(),v.dataset.dropping="true")}),v.addEventListener("dragleave",()=>{delete v.dataset.dropping}),v.addEventListener("drop",n=>{n.dataTransfer?.files.length&&(n.preventDefault(),delete v.dataset.dropping,ge(n.dataTransfer.files))}),w.addEventListener("paste",n=>{let i=Array.from(n.clipboardData?.files??[]);i.length!==0&&(n.preventDefault(),ge(i))}));let L={title:e.title??t.title,subtitle:e.subtitle??"",placeholder:t.placeholder,footnote:t.footnote??"",greeting:e.greeting??"",suggestions:e.suggestions??[]},se={...L,suggestions:[...L.suggestions]};function fe(){A.textContent=L.title,v.setAttribute("aria-label",L.title),T.textContent=L.subtitle,T.hidden=L.subtitle==="",ae.textContent=L.footnote,ae.hidden=L.footnote==="",Q()}function K(n){b(n?"open":"close",{}),n&&s.querySelector(".invite")?.remove(),v.dataset.open=String(n),x.setAttribute("aria-expanded",String(n)),x.setAttribute("aria-label",n?t.close:t.open),n?w.focus():x.focus()}function G(n){q.textContent=n,q.hidden=!1}async function ge(n){if(F){q.hidden=!0;for(let i of Array.from(n)){if(a.staged.length>=F.maxCount){G(`You can attach ${F.maxCount} files at a time.`);break}let d=(i.type||"").split(";")[0]?.trim().toLowerCase()??"";if(!F.accept.includes(d)){G(`${i.name} is not a file type we can read.`);continue}if(i.size>F.maxBytes){G(`${i.name} is larger than ${Math.round(F.maxBytes/1024/1024)}MB.`);continue}let h;try{h=await Qt(i)}catch{G(`${i.name} could not be read.`);continue}a.staged.push({name:i.name,mimeType:d,dataUrl:h,bytes:i.size})}he()}}function he(){Y.replaceChildren(),Y.hidden=a.staged.length===0;for(let[n,i]of a.staged.entries()){let d=document.createElement("span");d.className="chip";let h=document.createElement("span");h.textContent=i.name,d.appendChild(h);let g=document.createElement("button");g.type="button",g.setAttribute("aria-label",ue(t.removeFile,{name:i.name})),g.appendChild(D(W.close,!1)),g.addEventListener("click",()=>{a.staged.splice(n,1),he(),w.focus()}),d.appendChild(g),Y.appendChild(d)}}function J(){M.scrollTop=M.scrollHeight}function lt(n,i){let d=new Set;for(let O of i.matchAll(/\[(\d{1,2})\]/g))d.add(Number.parseInt(O[1],10)-1);let h=n.map((O,V)=>({ref:O,position:V})),g=h.filter(O=>d.has(O.position)),y=g.length>0?g:h,N=g.length>0,U=new Map,R=[],C=[];for(let O of y){let V=`${O.ref.url??""}|${O.ref.title}|${O.ref.section??""}`,S=U.get(V);if(S!==void 0){N&&C[S]?.push(O.position+1);continue}U.set(V,R.length),R.push(O.ref),C.push(N?[O.position+1]:[])}return{sources:R,citedAs:C}}function Oe(n,i,d=[]){if(i.length===0)return;let h=document.createElement("div");h.className="sources";for(let[g,y]of i.slice(0,4).entries()){let N=y.section?`${y.title} \xB7 ${y.section}`:y.title,U=d[g]??[],R=U.length>0?`${U.map(O=>`[${O}]`).join(" ")} ${N}`:N,C=document.createElement(y.url?"a":"span");C.textContent=R,y.url&&C instanceof HTMLAnchorElement&&(C.href=y.url,C.target="_blank",C.rel="noopener noreferrer"),h.appendChild(C)}n.appendChild(h)}function re(n){M.querySelector(".empty")?.remove();let i=document.createElement("div");i.className="msg",i.dataset.role=n.role;let d=document.createElement("div");return d.className="bubble",d.setAttribute("dir","auto"),n.role==="user"?d.textContent=n.content:d.appendChild(oe(n.content)),n.role==="user"&&!n.content&&n.attachments?.length?d.remove():i.appendChild(d),n.attachments?.length&&vt(i,n.attachments),n.sources&&Oe(i,n.sources,n.citedAs),M.appendChild(i),J(),{bubble:d,wrapper:i}}function be(){if(ie.replaceChildren(),Q(),a.suggestions.length!==0)for(let n of a.suggestions.slice(0,4)){let i=document.createElement("button");i.type="button",i.textContent=n,i.addEventListener("click",()=>{Z(n)}),ie.appendChild(i)}}function Q(){let n=a.busy||a.pickOne;w.disabled=a.pickOne,w.placeholder=a.pickOne?t.choosePlaceholder:L.placeholder,te.disabled=n}function le(){M.replaceChildren(),e.greetingArt&&a.messages.length===0?ct():L.greeting&&re({role:"assistant",content:L.greeting});for(let n of a.messages)n.unseen||re(n);be()}function ct(){let n=document.createElement("div");n.className="empty";let i=document.createElement("img");if(i.src=e.greetingArt,i.alt="",i.decoding="async",n.appendChild(i),L.greeting){let d=document.createElement("p");d.textContent=L.greeting,n.appendChild(d)}M.appendChild(n)}function dt(n){if(e.copy===!1||typeof navigator>"u"||!navigator.clipboard?.writeText)return;let i=document.createElement("button");return i.type="button",i.className="icon-button",i.setAttribute("aria-label",t.copy),i.appendChild(D("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z",!0)),i.addEventListener("click",()=>{navigator.clipboard.writeText(n).then(()=>{i.setAttribute("aria-label",t.copied),i.setAttribute("data-copied","true"),setTimeout(()=>{i.setAttribute("aria-label",t.copy),i.removeAttribute("data-copied")},1600)}).catch(()=>{})}),i}function De(){a.messages=[],a.suggestions=[...L.suggestions],a.pickOne=!1,a.conversationId=`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,et(e.endpoint,[],e.persist!==!1),le()}async function Ie(){let n=a.conversationId;De();try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deleteConversation:n})})}catch{}}function ut(n,i,d=""){let h=dt(d);if(e.feedback===!1){if(!h)return;let y=document.createElement("div");y.className="feedback",y.appendChild(h),n.appendChild(y);return}let g=document.createElement("div");g.className="feedback";for(let[y,N,U]of[["positive",t.helpful,"M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],["negative",t.notHelpful,"M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]]){let R=document.createElement("button");R.type="button",R.className="icon-button",R.setAttribute("aria-label",N),R.appendChild(D(U,!0)),R.addEventListener("click",()=>{R.setAttribute("aria-pressed","true"),g.querySelectorAll("button").forEach(C=>{C!==R&&C.removeAttribute("aria-pressed")}),pt(i,y).then(C=>{C||R.removeAttribute("aria-pressed")})}),g.appendChild(R)}h&&g.appendChild(h),n.appendChild(g)}async function pt(n,i){try{return(await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feedback:{conversationId:a.conversationId,messageIndex:n,value:i}})})).ok}catch{return!1}}async function Z(n,i={}){let d=n.trim();if(!d&&a.staged.length===0||a.busy)return;q.hidden=!0,a.busy=!0,a.pickOne=!1,Q(),z?.recording&&z.cancel(),w.dataset.beforeDictation="";let h=a.staged;a.staged=[],he();let g={role:"user",content:d};h.length>0&&(g.attachments=h),i.show===!1&&(g.unseen=!0),a.messages.push(g),g.unseen||(re(g),b("message",{text:d})),a.suggestions=[],be(),a.controller=new AbortController,await ve(void 0,h),a.busy=!1,Q(),a.controller=null,J(),w.disabled||w.focus()}async function ve(n,i){let{bubble:d,wrapper:h}=re({role:"assistant",content:""});M.setAttribute("aria-busy","true");let g=document.createElement("span");g.className="typing",g.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),d.appendChild(g);let y=null,N="",U=S=>{N+=S,R(mt(N))},R=S=>{if(!C.content){if(!S){y?.remove(),y=null,d.contains(g)||d.appendChild(g);return}g.remove(),y??(y=document.createElement("div")),y.className="working",y.textContent=ue(t.working,{name:S}),d.contains(y)||d.appendChild(y),J()}},C={role:"assistant",content:""},O=[],V=[];if(await We(e.endpoint,{messages:a.messages,conversationId:a.conversationId,userId:e.userId,userHash:e.userHash,contact:e.contact,actionResults:n,...i&&i.length>0?{attachments:i}:{}},{onSources:S=>{O=S},onDelta:S=>{g.remove(),y?.remove(),y=null,C.content+=S,d.replaceChildren(oe(C.content)),J()},onError:S=>{g.remove(),y?.remove(),y=null,G(S),b("error",{message:S})},onFrame:S=>gt(S,V,R,U)},a.controller?.signal,t).finally(()=>{g.remove(),M.setAttribute("aria-busy","false")}),V.length>0&&!n){h.remove();let S=V.find(we=>we.payload?.form);if(S){xe={name:S.name,input:S.input};let we=ze(S.payload?.form,Pe),de=document.createElement("div");de.className="msg",de.dataset.role="assistant",de.appendChild(we),M.appendChild(de),J();return}let yt=await bt(V);await ve(yt);return}if(C.content.trim()){let S=lt(O,C.content);C.sources=S.sources,C.citedAs=S.citedAs,a.messages.push(C),Oe(h,C.sources,C.citedAs),ut(h,a.messages.length-1,C.content),et(e.endpoint,a.messages,e.persist!==!1),b("response",{text:C.content,sources:C.sources})}else h.remove();be()}function mt(n){let i=n.split(`
`).filter(h=>h.trim()),d=i[i.length-1]??"";return d.length>120?`${d.slice(-120).trimStart()}`:d}function ft(n){return n.replace(/[_-]+/g," ").trim()}function gt(n,i,d=()=>{},h=()=>{}){if(n.type==="client-action")i.push({id:n.id,name:n.name,input:n.input,payload:n.payload});else if(n.type==="suggestions")a.suggestions=n.items,a.pickOne=n.pickOne===!0&&n.items.length>0;else if(n.type==="reasoning")h(n.text);else if(n.type==="action")b("action",{name:n.name,status:n.status,...n.input?{input:n.input}:{},...n.result===void 0?{}:{result:n.result}}),d(n.status==="running"?n.summary??ft(n.name):null);else if(n.type==="captured")b("captured",{kind:n.kind,name:n.name,values:n.values});else if(n.type==="notice")ce(n.message);else if(n.type==="handoff")b("handoff",{ticketId:n.ticketId,message:n.message}),ce(n.message);else if(n.type==="ui"){let g=Ue({kind:n.kind,id:n.id,data:n.data},Pe);if(g){let y=n.id?[...M.children].find(U=>U.dataset?.uiId===n.id):void 0,N=document.createElement("div");N.className="msg",N.dataset.role="assistant",n.id&&(N.dataset.uiId=n.id),N.appendChild(g),y?y.replaceWith(N):(M.appendChild(N),J())}}}let Pe={submit:n=>{Z(n)},respond:n=>{ht(n)},run:async(n,i)=>{let d=p[n];if(!d)throw new Error("That is not available here");return d(i)}},xe=null;async function ht(n){let i=xe;xe=null,!(!i||a.busy)&&(a.busy=!0,Q(),a.controller=new AbortController,await ve([{name:i.name,input:i.input,output:n}]),a.busy=!1,Q(),a.controller=null)}async function bt(n){return Promise.all(n.map(async i=>{let d=p[i.name];if(!d)return{name:i.name,input:i.input,output:{error:"no handler registered on this page"}};try{return{name:i.name,input:i.input,output:await d(i.input)}}catch(h){return{name:i.name,input:i.input,output:{error:h instanceof Error?h.message:String(h)}}}}))}function vt(n,i){let d=document.createElement("div");d.className="attached";for(let h of i){if(h.mimeType.startsWith("image/")){let y=document.createElement("img");y.src=h.dataUrl,y.alt=h.name,d.appendChild(y);continue}let g=document.createElement("span");g.className="chip",g.textContent=h.name,d.appendChild(g)}n.appendChild(d)}function ce(n){let i=document.createElement("div");i.className="notice",i.textContent=n,M.appendChild(i),J()}function xt(){if(r||!e.invite||v.dataset.open==="true")return;try{if(sessionStorage.getItem(Ze(e.endpoint)))return}catch{}let n=document.createElement("div");n.className=`invite ${c}`,n.setAttribute("role","button"),n.tabIndex=0,n.appendChild(document.createTextNode(e.invite));let i=document.createElement("button");i.type="button",i.className="invite-dismiss",i.setAttribute("aria-label",t.dismiss),i.appendChild(D(W.close,!1));let d=()=>{n.remove();try{sessionStorage.setItem(Ze(e.endpoint),"1")}catch{}};i.addEventListener("click",g=>{g.stopPropagation(),d()});let h=()=>{d(),K(!0)};n.addEventListener("click",h),n.addEventListener("keydown",g=>{(g.key==="Enter"||g.key===" ")&&(g.preventDefault(),h())}),n.appendChild(i),s.appendChild(n)}if(e.invite&&!r){let n=e.inviteDelay??4e3,i=setTimeout(xt,n);f.push(i)}x.addEventListener("click",()=>K(v.dataset.open!=="true")),P.addEventListener("click",()=>K(!1)),_.addEventListener("click",()=>{typeof window.confirm=="function"&&!window.confirm(t.deleteConfirm)||Ie()}),ee.addEventListener("submit",n=>{n.preventDefault();let i=w.value;w.value="",w.style.height="auto",Z(i)}),w.addEventListener("input",()=>{w.style.height="auto",w.style.height=`${w.scrollHeight}px`}),w.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),ee.requestSubmit())}),s.addEventListener("keydown",n=>{n.key==="Escape"&&!r&&K(!1)}),fe(),le();let ye={open(n){let i=n?.ask?.trim();if(!i){K(!0);return}if(!n?.quietly){K(!0),Z(i);return}let d=ye.on("response",()=>{d(),K(!0)});Z(i,{show:!1})},close:()=>K(!1),ask:n=>Z(n),setOptions(n){Object.assign(L,n),n.suggestions&&(L.suggestions=[...n.suggestions],a.messages.length===0&&(a.suggestions=[...n.suggestions])),fe(),le()},resetOptions(n){let i=Object.keys(se).filter(d=>!n||n[d]);for(let d of i)d==="suggestions"?L.suggestions=[...se.suggestions]:L[d]=se[d];i.includes("suggestions")&&a.messages.length===0&&(a.suggestions=[...se.suggestions]),fe(),le()},on(n,i){let d=u.get(n)??new Set;return d.add(i),u.set(n,d),()=>d.delete(i)},handle(n,i){p[n]=i},clear(){De()},forget:()=>Ie(),destroy(){a.controller?.abort();for(let n of f)clearTimeout(n);o.remove()},element:o};return e.deepLink!==!1&&Qe(ye),ye}function Jt(e,t){if(t!=="auto"){e.setAttribute("data-theme",t);return}let r=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>e.setAttribute("data-theme",r.matches?"dark":"light");o(),r.addEventListener("change",o)}function Yt(e){let t=Math.max(0,Math.floor((Date.now()-e)/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`}function D(e,t){let r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("viewBox","0 0 24 24"),r.setAttribute("aria-hidden","true"),r.setAttribute("fill",t?"currentColor":"none"),r.setAttribute("stroke",t?"none":"currentColor"),r.setAttribute("stroke-width","2"),r.setAttribute("stroke-linecap","round");let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",e),r.appendChild(o),r}function Xt(e){try{let t=sessionStorage.getItem(tt(e));if(!t)return[];let r=JSON.parse(t);return Array.isArray(r)?r.filter(o=>{if(typeof o!="object"||o===null)return!1;let s=o;return(s.role==="user"||s.role==="assistant")&&typeof s.content=="string"}):[]}catch{return[]}}function et(e,t,r){if(r)try{sessionStorage.setItem(tt(e),JSON.stringify(t.slice(-20)))}catch{}}function Qt(e){return new Promise((t,r)=>{let o=new FileReader;o.onload=()=>t(String(o.result)),o.onerror=()=>r(new Error("unreadable")),o.readAsDataURL(e)})}function Zt(){let t=document.currentScript?.dataset??{},r=t.endpoint??window.recourseConfig?.endpoint;if(!r)return console.warn("[recourse] no data-endpoint on the script tag, widget not mounted"),null;let o=t.target?document.querySelector(t.target):null;return{endpoint:r,userId:t.userId,userHash:t.userHash,feedback:t.feedback!=="false",invite:t.invite,inviteDelay:t.inviteDelay?Number(t.inviteDelay):void 0,title:t.title,subtitle:t.subtitle,...t.footnote?{strings:{footnote:t.footnote}}:{},greeting:t.greeting,greetingArt:t.greetingArt,accent:t.accent,suggestions:t.suggestions?.split("|").map(s=>s.trim()).filter(Boolean),position:t.position==="bottom-left"?"bottom-left":"bottom-right",theme:t.theme==="dark"||t.theme==="light"?t.theme:"auto",open:t.open==="true",persist:t.persist!=="false",deepLink:t.deepLink!=="false",...en(t.attachments),...t.dictation==="true"?{dictation:{...t.dictationLang?{lang:t.dictationLang}:{},...t.dictationCloud==="true"?{allowCloudFallback:!0}:{}}}:{},...t.call?{call:t.callTransport==="hosted"?{endpoint:t.call,transport:"hosted"}:t.call}:{},copy:t.copy!=="false",allowDelete:t.delete==="true",...window.recourseConfig,...o?{target:o}:{}}}function en(e){if(!e||e==="false")return{};if(e==="true")return{attachments:!0};let t=Number(e);return Number.isFinite(t)&&t>0?{attachments:{maxBytes:Math.round(t*1024*1024)}}:{}}var rt=Zt();if(rt){let e=()=>{window.recourse=nt(rt)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e()}})();
