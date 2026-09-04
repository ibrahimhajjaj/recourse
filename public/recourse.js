"use strict";(()=>{var kt=/(\*\*[^*]+\*\*|`[^`]+`|!?\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,Ct=/^(https?:|mailto:|\/|#)/i;function oe(e){let t=document.createDocumentFragment();for(let r of Et(e))t.appendChild(St(r));return t}function Et(e){let t=[],r=null,o=null,s=()=>{r&&r.lines.length>0&&t.push(r),r=null};for(let l of e.split(`
`)){if(/^\s*(```|~~~)/.test(l)){o?(t.push(o),o=null):(s(),o={kind:"code",lines:[]});continue}if(o){o.lines.push(l);continue}if(l.trim()===""){s();continue}let c=/^\s*[-*+]\s+(.*)$/.exec(l),a=/^\s*\d+[.)]\s+(.*)$/.exec(l),p=c?"ul":a?"ol":"p",g=c?.[1]??a?.[1]??l;(!r||r.kind!==p)&&(s(),r={kind:p,lines:[]}),r.lines.push(g)}return o&&t.push(o),s(),t}function St(e){if(e.kind==="code"){let r=document.createElement("pre"),o=document.createElement("code");return o.textContent=e.lines.join(`
`),r.appendChild(o),r}if(e.kind==="ul"||e.kind==="ol"){let r=document.createElement(e.kind);for(let o of e.lines){let s=document.createElement("li");s.appendChild(Pe(o)),r.appendChild(s)}return r}let t=document.createElement("p");return t.appendChild(Pe(e.lines.join(" "))),t}function Pe(e){let t=document.createDocumentFragment();for(let r of e.split(kt)){if(!r)continue;if(r.startsWith("**")&&r.endsWith("**")){t.appendChild(ke("strong",r.slice(2,-2)));continue}if(r.startsWith("`")&&r.endsWith("`")){t.appendChild(ke("code",r.slice(1,-1)));continue}if(r.startsWith("*")&&r.endsWith("*")&&r.length>2){t.appendChild(ke("em",r.slice(1,-1)));continue}let o=/^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(r);if(o){let l=o[2];if(/^https:/i.test(l)){let c=document.createElement("img");c.src=l,c.alt=o[1],c.loading="lazy",c.className="md-image",t.appendChild(c)}else t.appendChild(document.createTextNode(o[1]));continue}let s=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(r);if(s){let l=s[2];if(Ct.test(l)){let c=document.createElement("a");c.textContent=s[1],c.href=l,c.target="_blank",c.rel="noopener noreferrer",t.appendChild(c)}else t.appendChild(document.createTextNode(s[1]));continue}t.appendChild(document.createTextNode(r))}return t}function ke(e,t){let r=document.createElement(e);return r.textContent=t,r}var Ee=/^(https?:|mailto:|tel:|\/|#)/i;function Ce(e,t){let r=e.showIf;if(r===void 0)return!0;if(typeof r=="boolean")return r;if(typeof r=="string"){let o=r.startsWith("!"),s=o?r.slice(1):r,[l,c]=s.split("=",2),a=t[(l??"").trim()],p=c===void 0?!!a:String(a)===c.trim();return o?!p:p}return!0}function I(e,t,r){let o=document.createElement(e);return o.textContent=t,r&&(o.className=r),o}function E(e){return typeof e=="string"?e:e==null?"":String(e)}function ze(e,t,r,o=!1){if(!Ee.test(t))return I("span",e,r);let s=document.createElement("a");return s.textContent=e,s.href=t,o||(s.target="_blank"),s.rel="noopener noreferrer",s.className=r,s}var At=e=>{let t=E(e.label)||"Open",r=E(e.url);if(!r)return null;let o=document.createElement("div");return o.className="ui-actions",o.appendChild(ze(t,r,"ui-button",e.sameTab===!0)),o};function Tt(e,t){let r=E(e.label);if(!r)return null;if(e.url)return ze(r,E(e.url),"ui-button");let o=document.createElement("button");return o.type="button",o.className="ui-button",o.textContent=r,e.run?(o.addEventListener("click",async()=>{if(t.run){o.disabled=!0;try{await t.run(E(e.run),e.payload??{}),o.replaceWith(I("span",E(e.done)||"Done","ui-muted"))}catch(s){o.disabled=!1,o.textContent=s instanceof Error?s.message:"That did not work"}}}),o):(o.addEventListener("click",()=>t.submit(E(e.send)||r)),o)}var Lt=(e,t)=>{let r=document.createElement("div");if(r.className="ui-card",e.image&&Ee.test(E(e.image))){let c=document.createElement("img");c.src=E(e.image),c.alt=E(e.title),c.loading="lazy",c.className="ui-card-image",r.appendChild(c)}let o=document.createElement("div");o.className="ui-card-body",e.title&&o.appendChild(I("h3",E(e.title))),e.subtitle&&o.appendChild(I("p",E(e.subtitle),"ui-muted"));let s=(Array.isArray(e.fields)?e.fields:[]).filter(c=>Ce(c,e));if(s.length>0){let c=document.createElement("dl");c.className="ui-fields";for(let a of s){let p=a;c.appendChild(I("dt",E(p.label))),c.appendChild(I("dd",E(p.value)))}o.appendChild(c)}let l=(Array.isArray(e.actions)?e.actions:[]).filter(c=>Ce(c,e));if(l.length>0){let c=document.createElement("div");c.className="ui-actions";for(let a of l){let p=Tt(a,t);p&&c.appendChild(p)}c.childElementCount>0&&o.appendChild(c)}return r.appendChild(o),r},Mt=e=>{let t=(Array.isArray(e.columns)?e.columns:[]).map(E),r=Array.isArray(e.rows)?e.rows:[];if(t.length===0||r.length===0)return null;let o=document.createElement("div");o.className="ui-table-wrap";let s=document.createElement("table");s.className="ui-table";let l=document.createElement("thead"),c=document.createElement("tr");for(let p of t)c.appendChild(I("th",p));l.appendChild(c),s.appendChild(l);let a=document.createElement("tbody");for(let p of r.slice(0,25)){let g=document.createElement("tr"),u=Array.isArray(p)?p:t.map(v=>p[v]);for(let v of u)g.appendChild(I("td",E(v)));a.appendChild(g)}return s.appendChild(a),o.appendChild(s),o},Rt=(e,t)=>{let r=(Array.isArray(e.items)?e.items:[]).filter(s=>Ce(s,e));if(r.length===0)return null;let o=document.createElement("div");o.className="ui-list";for(let s of r){let l=s,c=E(l.title);if(!c)continue;let a=document.createElement(l.url?"a":"button");a.className="ui-list-item",a instanceof HTMLAnchorElement&&Ee.test(E(l.url))?(a.href=E(l.url),a.target="_blank",a.rel="noopener noreferrer"):a instanceof HTMLButtonElement&&(a.type="button",a.addEventListener("click",()=>t.submit(E(l.send)||c))),a.appendChild(I("span",c,"ui-list-title")),l.subtitle&&a.appendChild(I("span",E(l.subtitle),"ui-muted")),o.appendChild(a)}return o.childElementCount>0?o:null};function Ue(e,t){let r=document.createElement("form");r.className="ui-form",e.title&&r.appendChild(I("h3",e.title));let o=Array.isArray(e.fields)?e.fields:[],s=[];for(let a of o){let p=a,g=E(p.name);if(!g)continue;let u=document.createElement("label");u.className="ui-field",u.appendChild(I("span",E(p.label)||g));let v,k=Dt(p.groups);if(k||Array.isArray(p.options)&&p.options.length>0){let m=document.createElement("select");if(p.multiple===!0&&(m.multiple=!0),k)for(let[f,y]of k){let A=document.createElement("optgroup");A.label=f;for(let T of y)A.appendChild(Fe(T));m.appendChild(A)}else for(let f of p.options)m.appendChild(Fe(E(f)));v=m}else if(p.type==="boolean"){let m=document.createElement("input");m.type="checkbox",v=m}else if(p.input==="multiline"){let m=document.createElement("textarea");m.rows=3,p.placeholder&&(m.placeholder=E(p.placeholder)),v=m}else{let m=document.createElement("input");m.type=Ot(p.input,p.type),p.placeholder&&(m.placeholder=E(p.placeholder)),v=m}v.name=g,p.required!==!1&&v instanceof HTMLTextAreaElement&&(v.required=!0),p.required!==!1&&v instanceof HTMLInputElement&&v.type!=="checkbox"&&(v.required=!0),It(v,p),u.appendChild(v),r.appendChild(u),s.push({name:g,element:v})}let l=document.createElement("button");l.type="submit",l.className="ui-button",l.textContent=e.submitLabel||"Send",r.appendChild(l);let c=!1;return r.addEventListener("submit",a=>{if(a.preventDefault(),c)return;c=!0;let p={};for(let{name:g,element:u}of s)p[g]=Ht(u);r.replaceChildren(oe("Thanks, sending that now.")),t.respond(p)}),r}var Nt={button:At,card:Lt,table:Mt,list:Rt};function je(e,t){let r=Nt[e.kind];return r?r(e.data,t):null}function Ot(e,t){return e==="date"||e==="email"||e==="tel"?e:t==="number"?"number":"text"}function Fe(e){let t=document.createElement("option");return t.value=e,t.textContent=e,t}function Dt(e){if(!e||typeof e!="object"||Array.isArray(e))return null;let t=Object.entries(e).map(([r,o])=>[r,(Array.isArray(o)?o:[]).map(s=>E(s)).filter(Boolean)]).filter(([,r])=>r.length>0);return t.length>0?t:null}function It(e,t){let r=E(t.invalidMessage);if(e instanceof HTMLSelectElement||(typeof t.pattern=="string"&&t.pattern&&e instanceof HTMLInputElement&&(e.pattern=t.pattern),typeof t.minLength=="number"&&(e.minLength=t.minLength),typeof t.maxLength=="number"&&(e.maxLength=t.maxLength),e instanceof HTMLInputElement&&e.type==="number"&&(typeof t.min=="number"&&(e.min=String(t.min)),typeof t.max=="number"&&(e.max=String(t.max))),!r))return;let o=()=>e.setCustomValidity(e.validity.valid?"":r);e.addEventListener("input",()=>{e.setCustomValidity(""),o()}),e.addEventListener("invalid",o)}function Ht(e){return e instanceof HTMLInputElement&&e.type==="checkbox"?e.checked:e instanceof HTMLSelectElement&&e.multiple?[...e.selectedOptions].map(t=>t.value):e.value}var Pt={offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status})."};async function We(e,t,r,o,s=Pt){let l;try{l=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,messages:t.messages.map(g=>({role:g.role,content:g.content}))}),signal:o})}catch{r.onError?.(s.offline);return}if(!l.ok||!l.body){r.onError?.(l.status===429?s.rateLimited:s.unavailable.replace("{status}",String(l.status)));return}let c=l.body.getReader(),a=new TextDecoder,p="";for(;;){let{done:g,value:u}=await c.read();if(g)break;p+=a.decode(u,{stream:!0});let v=p.split(`

`);p=v.pop()??"";for(let k of v){let m=k.split(`
`).find(y=>y.startsWith("data:"));if(!m)continue;let f;try{f=JSON.parse(m.slice(5).trim())}catch{continue}r.onFrame?.(f),f.type==="sources"?r.onSources?.(f.sources):f.type==="delta"?r.onDelta?.(f.text):f.type==="done"?r.onDone?.():f.type==="error"&&r.onError?.(f.message)}}r.onDone?.()}function Ft(e=globalThis){let t=e;return t.SpeechRecognition??t.webkitSpeechRecognition??null}var zt={"not-allowed":"I need permission to use the microphone. You can allow it in your browser settings.","service-not-allowed":"Your browser would not let me use speech recognition.","no-speech":"I did not hear anything. Try again?","audio-capture":"I could not find a microphone.",network:"Speech recognition needs a connection and could not reach it.","language-not-supported":"Speech recognition is not available for this language on your device."};function Be(e={},t=globalThis){let r=Ft(t);if(!r)return null;let o=r,s=null,l=!1;function c(g){let u=new o;u.continuous=!0,u.interimResults=!0,u.maxAlternatives=1;let v=e.lang??Ut(t);return v&&(u.lang=v),g&&(u.processLocally=!0),u}function a(g){g.onstart=()=>e.onStateChange?.(!0),g.onresult=u=>{let v="";for(let k=u.resultIndex;k<u.results.length;k++){let m=u.results[k];if(!m)continue;let f=m[0]?.transcript??"";m.isFinal?e.onFinal?.(f):v+=f}v&&e.onInterim?.(v)},g.onerror=u=>{let v=e.processLocally!==!1,k=u.error==="language-not-supported"||u.error==="service-not-allowed";if(v&&k&&e.allowCloudFallback&&!l){l=!0,s=null,p(!1);return}u.error!=="aborted"&&e.onError?.(zt[u.error]??"Speech recognition stopped unexpectedly.")},g.onend=()=>{s=null,e.onStateChange?.(!1)}}function p(g){let u=c(g);a(u),s=u;try{u.start()}catch{s=null,e.onStateChange?.(!1)}}return{get recording(){return s!==null},start(){s||(l=!1,p(e.processLocally!==!1))},stop(){s?.stop()},cancel(){let g=s;s=null,g?.abort(),e.onStateChange?.(!1)},toggle(){s?this.stop():this.start()}}}function Ut(e){return e.document?.documentElement?.lang??""}function $e(e){let t=e.fetch??globalThis.fetch.bind(globalThis),r=e.load??Wt,o="idle",s=null,l=0,c=u=>{o!==u&&(o=u,e.onStateChange?.(u))},a=u=>{c("failed"),e.onError?.(u)};async function p(){if(o==="connecting"||o==="live")return;let u=++l;c("connecting");let v;try{let m=await t(e.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:e.conversationId()})});if(m.status===429){u===l&&a("Too many calls just now. Try again in a moment.");return}if(!m.ok){u===l&&a("Calling is not available right now.");return}let f=await m.json();if(typeof f.signedUrl!="string"||!f.signedUrl){u===l&&a("Calling is not available right now.");return}v=f.signedUrl}catch{u===l&&a("Could not reach the server to start the call.");return}if(u!==l)return;let k;try{k=await r()}catch{u===l&&a("Could not load the voice connection.");return}if(u===l)try{let m=await k.startSession({signedUrl:v,onConnect:()=>{u===l&&c("live")},onDisconnect:()=>{u===l&&(s=null,c("ended"))},onError:()=>{u===l&&a("The call ended unexpectedly. Your microphone may be blocked.")},onMessage:f=>{let y=typeof f?.message=="string"?f.message.trim():"";y&&e.onTranscript?.({role:f.source==="user"?"visitor":"agent",text:y})}});if(u!==l){await Promise.resolve(m.endSession()).catch(()=>{});return}s=m}catch{u===l&&a("Could not start the call. Your microphone may be blocked.")}}async function g(){l++;let u=s;if(s=null,u)try{await u.endSession()}catch{}c(o==="failed"?"failed":"ended")}return{get state(){return o},start:p,stop:g,async toggle(){o==="connecting"||o==="live"?await g():await p()}}}var jt="https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";async function Wt(){let t=await import(jt);if(!t.Conversation)throw new Error("no conversation runtime in the loaded module");return t.Conversation}function _e(e,t,r=16e3){if(r>=t||e.length===0)return e;let o=t/r,s=new Float32Array(Math.floor(e.length/o));for(let l=0;l<s.length;l++){let c=Math.floor(l*o),a=Math.min(e.length,Math.floor((l+1)*o)),p=0;for(let g=c;g<a;g++)p+=e[g];s[l]=a>c?p/(a-c):0}return s}function qe(e){let t=new Int16Array(e.length);for(let r=0;r<e.length;r++){let o=Math.max(-1,Math.min(1,e[r]));t[r]=o<0?o*32768:o*32767}return t}function Ve(e){if(e.length===0)return 0;let t=0;for(let r of e)t+=r*r;return Math.min(1,Math.sqrt(t/e.length)/32768)}var $t=`
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
`,_t={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:1},qt=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"];function Se(){let e=globalThis.MediaRecorder;return e?.isTypeSupported?qt.find(t=>e.isTypeSupported?.(t))??null:null}async function Ke(e){let t=e.frameMs??20,{context:r,stream:o}=await(e.open??Kt)(),s=Math.round(r.sampleRate*t/1e3),l=r.createMediaStreamSource(o),c=URL.createObjectURL(new Blob([$t],{type:"application/javascript"}));try{await r.audioWorklet.addModule(c)}finally{URL.revokeObjectURL(c)}let a=new AudioWorkletNode(r,"recourse-capture",{numberOfInputs:1,numberOfOutputs:0,processorOptions:{frameSamples:s}});a.port.onmessage=g=>{let u=_e(g.data,r.sampleRate,16e3);e.onFrame(qe(u))},l.connect(a);let p=null;if(e.onCompressed){let g=Se();if(g){let u=!0;p=(e.record??Vt)(o,g,e.chunkMs??200,v=>{let k=u;u=!1,v.size!==0&&v.arrayBuffer().then(m=>e.onCompressed?.(m,k))})}}return{async stop(){a.port.onmessage=null,p?.stop(),l.disconnect(),a.disconnect();for(let g of o.getTracks())g.stop();await r.close()}}}function Vt(e,t,r,o){let s=new MediaRecorder(e,{mimeType:t});return s.ondataavailable=l=>o(l.data),s.start(r),{stop:()=>{try{s.state!=="inactive"&&s.stop()}catch{}}}}async function Kt(){let e=await navigator.mediaDevices.getUserMedia({audio:_t});return{context:new AudioContext,stream:e}}function Ge(e){let t=e.cushionSeconds??.05,r=0;return{get endsAt(){return r},get playing(){return r>e.now()},push(o){if(o.length===0)return;let s=e.now(),l=r>s?r:s+t;e.play(o,l),r=l+o.length/e.sampleRate},clear(){r=0}}}function Je(e){let t="idle",r=null,o=null,s=null,l=null,c=0,a=f=>{t!==f&&(t=f,e.onStateChange?.(f))},p=f=>{a("failed"),e.onError?.(f)};async function g(){let f=o,y=s,A=r;o=null,s=null,l=null,r=null;try{A?.close()}catch{}await f?.stop().catch(()=>{}),y?.stop(),await y?.close().catch(()=>{})}async function u(){if(t==="connecting"||t==="live")return;let f=++c;a("connecting");let y;try{y=(e.connect??Jt)(Gt(e.endpoint))}catch{f===c&&p("Could not reach the server to start the call.");return}y.binaryType="arraybuffer",r=y,y.onopen=()=>{if(f!==c){y.close();return}let A=e.compress===!1?null:Se();y.send(JSON.stringify({type:"hello",sampleRate:16e3,conversationId:e.conversationId(),...A?{audio:{mimeType:A}}:{}})),v(f,y,A)},y.onmessage=A=>{if(f===c){if(typeof A.data=="string"){let T;try{T=JSON.parse(A.data)}catch{return}T.type==="transcript"&&T.text&&T.role&&e.onTranscript?.({role:T.role,text:T.text}),T.type==="interrupted"&&(s?.stop(),l?.clear()),T.type==="error"&&e.onError?.(T.message??"Something went wrong.");return}A.data instanceof ArrayBuffer&&k(f,A.data)}},y.onerror=()=>{f===c&&(g(),p("The call was cut off."))},y.onclose=()=>{f===c&&(g(),(t==="live"||t==="connecting")&&a("ended"))}}async function v(f,y,A){try{s=(e.audio??Yt)(),l=Ge({now:s.now,play:s.play,sampleRate:s.sampleRate});let T=[],_=()=>{T.length===0||!Ae(y)||(y.send(JSON.stringify({type:"levels",values:T,frameMs:20})),T=[])};if(o=await(e.microphone??Ke)({onFrame:H=>{if(!(f!==c||!Ae(y))){if(A){T.push(Ve(H)),T.length>=5&&_();return}y.send(H)}},...A?{onCompressed:H=>{f!==c||!Ae(y)||(_(),y.send(H))}}:{}}),f!==c){await g();return}a("live")}catch{if(f!==c)return;await g(),p("Could not use your microphone. It may be blocked for this site.")}}async function k(f,y){try{let A=await s?.decode(y);if(f!==c||!A)return;l?.push(A)}catch{}}async function m(){c++,await g(),a(t==="failed"?"failed":"ended")}return{get state(){return t},start:u,stop:m,async toggle(){t==="connecting"||t==="live"?await m():await u()}}}function Ae(e){return e.readyState===1||e.readyState==="open"}function Gt(e){if(/^wss?:\/\//i.test(e))return e;let t=new URL(e,location.href);return t.protocol=t.protocol==="https:"?"wss:":"ws:",t.toString()}function Jt(e){return new WebSocket(e)}function Yt(){let e=new AudioContext,t=[];return{sampleRate:e.sampleRate,now:()=>e.currentTime,decode:async r=>(await e.decodeAudioData(r)).getChannelData(0),play:(r,o)=>{let s=e.createBuffer(1,r.length,e.sampleRate);s.getChannelData(0).set(r);let l=e.createBufferSource();l.buffer=s,l.connect(e.destination),l.onended=()=>{t=t.filter(c=>c!==l)},l.start(o),t.push(l)},stop:()=>{for(let r of t)try{r.stop()}catch{}t=[]},close:()=>e.close()}}var Ye=`
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
.ui-field input[type="email"],
.ui-field input[type="tel"],
.ui-field input[type="date"],
.ui-field textarea,
.ui-field select {
  font: inherit;
  font-size: 14px;
  color: var(--rc-ink);
  background: var(--rc-bg);
  border: 1px solid var(--rc-line);
  border-radius: 9px;
  padding: 8px 10px;
}
.ui-field input:focus, .ui-field textarea:focus, .ui-field select:focus {
  outline: 2px solid var(--rc-accent);
  outline-offset: -1px;
}
/* Down only. Wider is the panel's job and it has none to give. */
.ui-field textarea { resize: vertical; min-height: 60px; }
/* A multiple select collapses to one row otherwise, and looks like a dropdown
   that will not open. */
.ui-field select[multiple] { min-height: 88px; }
/* Only once they have typed something. Marking an empty required field red
   before anybody has touched it is the form telling them off in advance. */
.ui-field :invalid:not(:placeholder-shown) { border-color: var(--rc-alert); }
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
`;var Xe={title:"Ask us anything",open:"Open the support chat",close:"Close the support chat",placeholder:"Type your question",choosePlaceholder:"Choose one of the options above",send:"Send",inputLabel:"Your question",attach:"Attach a file",removeFile:"Remove {name}",dictate:"Dictate your question",stopDictating:"Stop dictating",listening:"Listening, press again to stop",call:"Talk to us",endCall:"End the call",calling:"Connecting, this can take a few seconds",onCall:"On a call \xB7 {time}",callAgain:"Call again, the last call failed",callStarted:"Call started",callEnded:"Call ended",working:"Checking {name}",helpful:"This helped",notHelpful:"This did not help",thanks:"Thanks, that helps us improve.",copy:"Copy this answer",copied:"Copied",deleteConversation:"Delete this conversation",deleteConfirm:"Delete this conversation? It cannot be brought back.",offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status}).",submit:"Send",submitted:"Thanks, sending that now.",dismiss:"Dismiss"};function Qe(e){if(!e)return Xe;let t={...Xe};for(let[r,o]of Object.entries(e))typeof o=="string"&&o.trim().length>0&&(t[r]=o);return t}function ue(e,t){return e.replace(/\{(\w+)\}/g,(r,o)=>o in t?String(t[o]):r)}var Xt=["recourse_q","rc_q"];function Qt(e={}){let t=e.params??Xt,r;try{r=new URL(e.href??window.location.href)}catch{return null}let o=null;for(let s of t){let l=r.searchParams.get(s);if(l&&l.trim()){o=l.trim().slice(0,1e3);break}}if(o===null)return null;if(e.strip!==!1){for(let s of t)r.searchParams.delete(s);try{window.history.replaceState(window.history.state,"",r.toString())}catch{}}return o}function Ze(e,t={}){let r=Qt(t);return r===null?null:(e.open(),e.ask(r),r)}function nt(e){return`recourse:transcript:${e}`}function et(e){return`recourse:invite:${e}`}var j={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z",clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",mic:"M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",phone:"M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",hangUp:"M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"},Zt=["image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/markdown","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];function rt(e){if(!e.endpoint)throw new Error("recourse: an `endpoint` is required");let t=Qe(e.strings),r=!!e.target,o=document.createElement("div");o.setAttribute("data-recourse",""),r&&o.setAttribute("data-inline","true"),o.style.cssText=r?"display:block;width:100%;height:100%":"";let s=o.attachShadow({mode:"open"}),l=document.createElement("style");l.textContent=Ye,s.appendChild(l),e.accent&&o.style.setProperty("--rc-accent",e.accent),en(o,e.theme??"auto");let c=e.position==="bottom-left"?"pos-left":"pos-right",a={messages:e.persist===!1?[]:nn(e.endpoint),busy:!1,controller:null,conversationId:`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,suggestions:[...e.suggestions??[]],pickOne:!1,staged:[]},p={...e.actions},g=[],u=new Map;function v(n,i){for(let d of u.get(n)??[])try{d(i)}catch(b){console.error(`[recourse] listener for "${n}" threw`,b)}}let k=document.createElement("button");k.className=`launcher ${c}`,k.type="button",k.setAttribute("aria-label",t.open),k.setAttribute("aria-expanded","false"),k.appendChild(D(j.chat,!0));let m=document.createElement("div");m.className=`panel ${c}`,m.setAttribute("role","dialog"),m.setAttribute("aria-modal","false"),m.setAttribute("aria-label",e.title??t.title),m.dataset.open=String(r||e.open===!0);let f=document.createElement("div");f.className="header";let y=document.createElement("div");y.className="grow";let A=document.createElement("h2");y.appendChild(A);let T=document.createElement("p");y.appendChild(T),f.appendChild(y);let _=document.createElement("button");_.className="icon-button",_.type="button",_.setAttribute("aria-label",t.deleteConversation),_.appendChild(D("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z",!1)),e.allowDelete&&f.appendChild(_);let H=document.createElement("button");H.className="icon-button",H.type="button",H.setAttribute("aria-label",t.close),H.appendChild(D(j.close,!1)),r||f.appendChild(H);let L=document.createElement("div");L.className="log",L.setAttribute("role","log"),L.setAttribute("aria-live","polite"),L.setAttribute("aria-relevant","additions text"),L.setAttribute("aria-live","polite"),L.setAttribute("aria-relevant","additions text");let ie=document.createElement("div");ie.className="suggestions";let V=document.createElement("div");V.className="error",V.hidden=!0,V.setAttribute("role","alert");let ee=document.createElement("form");ee.className="composer";let w=document.createElement("textarea");w.setAttribute("dir","auto"),w.rows=1,w.placeholder=t.placeholder,w.setAttribute("aria-label",t.inputLabel);let te=document.createElement("button");te.type="submit",te.setAttribute("aria-label",t.send),te.appendChild(D(j.send,!0));let P=e.attachments?{maxBytes:(typeof e.attachments=="object"?e.attachments.maxBytes:void 0)??10*1024*1024,maxCount:(typeof e.attachments=="object"?e.attachments.maxCount:void 0)??4,accept:(typeof e.attachments=="object"?e.attachments.accept:void 0)??Zt}:null,Y=document.createElement("div");Y.className="tray",Y.hidden=!0;let F=document.createElement("input");F.type="file",F.multiple=!0,F.hidden=!0,F.tabIndex=-1;let X=document.createElement("button");X.type="button",X.className="attach",X.setAttribute("aria-label",t.attach),X.appendChild(D(j.clip,!1));let Te=e.dictation?typeof e.dictation=="object"?e.dictation:{}:null,W=document.createElement("button");W.type="button",W.className="mic",W.setAttribute("aria-label",t.dictate),W.appendChild(D(j.mic,!1));let z=null,Le=!1,Me;P&&(F.accept=P.accept.join(",")),Te&&(z=Be({...Te,onStateChange:n=>{W.dataset.recording=String(n),W.setAttribute("aria-label",n?t.stopDictating:t.dictate),W.setAttribute("aria-pressed",String(n)),W.replaceChildren(n?Object.assign(document.createElement("span"),{className:"stop"}):D(j.mic,!1)),n?ne("listening",t.listening):Le||ne(null),n||(w.dataset.interim="")},onInterim:n=>{w.value=`${w.dataset.beforeDictation??""}${n}`},onFinal:n=>{let i=w.dataset.beforeDictation??"",d=i&&!i.endsWith(" ")?`${i} ${n}`:`${i}${n}`;w.value=d,w.dataset.beforeDictation=d},onError:n=>G(n)}),z&&(W.addEventListener("click",()=>{z&&(z.recording||(w.dataset.beforeDictation=w.value),z.toggle(),w.focus())}),w.addEventListener("keydown",n=>{n.key==="Escape"&&z?.recording&&(n.preventDefault(),w.value=w.dataset.beforeDictation??"",z.cancel())})));let Re=typeof e.call=="string"?e.call:e.call?e.call.endpoint:null,Ne=typeof e.call=="object"?e.call.load:void 0,it=typeof e.call=="object"?e.call.transport:void 0,B=document.createElement("button");B.type="button",B.className="call",B.setAttribute("aria-label",t.call),B.appendChild(D(j.phone,!1));let pe=null;if(Re){let n={endpoint:Re,conversationId:()=>a.conversationId,onStateChange:i=>at(i),onTranscript:({role:i,text:d})=>{re({role:i==="visitor"?"user":"assistant",content:d})},onError:i=>G(i)};pe=it==="hosted"?Je(n):$e({...n,...Ne?{load:Ne}:{}}),B.addEventListener("click",()=>{pe?.toggle()})}function at(n){B.dataset.state=n;let i=n==="live"||n==="connecting",d=n==="failed";if(B.setAttribute("aria-label",i?t.endCall:d?t.callAgain:t.call),B.replaceChildren(D(i?j.hangUp:j.phone,!1)),d&&B.appendChild(Object.assign(document.createElement("span"),{className:"failed"})),clearInterval(Me),n==="live"){let b=Date.now(),h=()=>ne("live",ue(t.onCall,{time:tn(b)}));h(),Me=setInterval(h,1e3)}else n==="connecting"?ne("connecting",t.calling):z?.recording||ne(null);Le=i,n==="live"&&ce(t.callStarted),n==="ended"&&ce(t.callEnded)}let st=z?[W]:[],lt=pe?[B]:[];ee.append(...P?[X]:[],w,...st,...lt,te);let ae=document.createElement("p");ae.className="footnote";let $=document.createElement("p");$.className="status",$.setAttribute("role","status"),$.setAttribute("aria-live","polite"),$.hidden=!0,$.append(Object.assign(document.createElement("span"),{className:"dot"}));let me=document.createElement("span");$.appendChild(me);function ne(n,i=""){if($.hidden=n===null,n===null){me.textContent="",$.removeAttribute("data-kind");return}$.dataset.kind=n,me.textContent=i}m.append(f,L,ie,V,Y,ee,$,ae),P&&m.appendChild(F),r?s.append(m):s.append(k,m),(e.target??document.body).appendChild(o),P&&(X.addEventListener("click",()=>F.click()),F.addEventListener("change",()=>{F.files&&ge(F.files),F.value=""}),m.addEventListener("dragover",n=>{n.dataTransfer?.types.includes("Files")&&(n.preventDefault(),m.dataset.dropping="true")}),m.addEventListener("dragleave",()=>{delete m.dataset.dropping}),m.addEventListener("drop",n=>{n.dataTransfer?.files.length&&(n.preventDefault(),delete m.dataset.dropping,ge(n.dataTransfer.files))}),w.addEventListener("paste",n=>{let i=Array.from(n.clipboardData?.files??[]);i.length!==0&&(n.preventDefault(),ge(i))}));let M={title:e.title??t.title,subtitle:e.subtitle??"",placeholder:t.placeholder,footnote:t.footnote??"",greeting:e.greeting??"",suggestions:e.suggestions??[]},se={...M,suggestions:[...M.suggestions]};function fe(){A.textContent=M.title,m.setAttribute("aria-label",M.title),T.textContent=M.subtitle,T.hidden=M.subtitle==="",ae.textContent=M.footnote,ae.hidden=M.footnote==="",Q()}function K(n){v(n?"open":"close",{}),n&&s.querySelector(".invite")?.remove(),m.dataset.open=String(n),k.setAttribute("aria-expanded",String(n)),k.setAttribute("aria-label",n?t.close:t.open),n?w.focus():k.focus()}function G(n){V.textContent=n,V.hidden=!1}async function ge(n){if(P){V.hidden=!0;for(let i of Array.from(n)){if(a.staged.length>=P.maxCount){G(`You can attach ${P.maxCount} files at a time.`);break}let d=(i.type||"").split(";")[0]?.trim().toLowerCase()??"";if(!P.accept.includes(d)){G(`${i.name} is not a file type we can read.`);continue}if(i.size>P.maxBytes){G(`${i.name} is larger than ${Math.round(P.maxBytes/1024/1024)}MB.`);continue}let b;try{b=await rn(i)}catch{G(`${i.name} could not be read.`);continue}a.staged.push({name:i.name,mimeType:d,dataUrl:b,bytes:i.size})}he()}}function he(){Y.replaceChildren(),Y.hidden=a.staged.length===0;for(let[n,i]of a.staged.entries()){let d=document.createElement("span");d.className="chip";let b=document.createElement("span");b.textContent=i.name,d.appendChild(b);let h=document.createElement("button");h.type="button",h.setAttribute("aria-label",ue(t.removeFile,{name:i.name})),h.appendChild(D(j.close,!1)),h.addEventListener("click",()=>{a.staged.splice(n,1),he(),w.focus()}),d.appendChild(h),Y.appendChild(d)}}function J(){L.scrollTop=L.scrollHeight}function ct(n,i){let d=new Set;for(let O of i.matchAll(/\[(\d{1,2})\]/g))d.add(Number.parseInt(O[1],10)-1);let b=n.map((O,q)=>({ref:O,position:q})),h=b.filter(O=>d.has(O.position)),x=h.length>0?h:b,N=h.length>0,U=new Map,R=[],C=[];for(let O of x){let q=`${O.ref.url??""}|${O.ref.title}|${O.ref.section??""}`,S=U.get(q);if(S!==void 0){N&&C[S]?.push(O.position+1);continue}U.set(q,R.length),R.push(O.ref),C.push(N?[O.position+1]:[])}return{sources:R,citedAs:C}}function Oe(n,i,d=[]){if(i.length===0)return;let b=document.createElement("div");b.className="sources";for(let[h,x]of i.slice(0,4).entries()){let N=x.section?`${x.title} \xB7 ${x.section}`:x.title,U=d[h]??[],R=U.length>0?`${U.map(O=>`[${O}]`).join(" ")} ${N}`:N,C=document.createElement(x.url?"a":"span");C.textContent=R,x.url&&C instanceof HTMLAnchorElement&&(C.href=x.url,C.target="_blank",C.rel="noopener noreferrer"),b.appendChild(C)}n.appendChild(b)}function re(n){L.querySelector(".empty")?.remove();let i=document.createElement("div");i.className="msg",i.dataset.role=n.role;let d=document.createElement("div");return d.className="bubble",d.setAttribute("dir","auto"),n.role==="user"?d.textContent=n.content:d.appendChild(oe(n.content)),n.role==="user"&&!n.content&&n.attachments?.length?d.remove():i.appendChild(d),n.attachments?.length&&xt(i,n.attachments),n.sources&&Oe(i,n.sources,n.citedAs),L.appendChild(i),J(),{bubble:d,wrapper:i}}function be(){if(ie.replaceChildren(),Q(),a.suggestions.length!==0)for(let n of a.suggestions.slice(0,4)){let i=document.createElement("button");i.type="button",i.textContent=n,i.addEventListener("click",()=>{Z(n)}),ie.appendChild(i)}}function Q(){let n=a.busy||a.pickOne;w.disabled=a.pickOne,w.placeholder=a.pickOne?t.choosePlaceholder:M.placeholder,te.disabled=n}function le(){L.replaceChildren(),e.greetingArt&&a.messages.length===0?dt():M.greeting&&re({role:"assistant",content:M.greeting});for(let n of a.messages)n.unseen||re(n);be()}function dt(){let n=document.createElement("div");n.className="empty";let i=document.createElement("img");if(i.src=e.greetingArt,i.alt="",i.decoding="async",n.appendChild(i),M.greeting){let d=document.createElement("p");d.textContent=M.greeting,n.appendChild(d)}L.appendChild(n)}function ut(n){if(e.copy===!1||typeof navigator>"u"||!navigator.clipboard?.writeText)return;let i=document.createElement("button");return i.type="button",i.className="icon-button",i.setAttribute("aria-label",t.copy),i.appendChild(D("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z",!0)),i.addEventListener("click",()=>{navigator.clipboard.writeText(n).then(()=>{i.setAttribute("aria-label",t.copied),i.setAttribute("data-copied","true"),setTimeout(()=>{i.setAttribute("aria-label",t.copy),i.removeAttribute("data-copied")},1600)}).catch(()=>{})}),i}function De(){a.messages=[],a.suggestions=[...M.suggestions],a.pickOne=!1,a.conversationId=`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,tt(e.endpoint,[],e.persist!==!1),le()}async function Ie(){let n=a.conversationId;De();try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deleteConversation:n})})}catch{}}function pt(n,i,d=""){let b=ut(d);if(e.feedback===!1){if(!b)return;let x=document.createElement("div");x.className="feedback",x.appendChild(b),n.appendChild(x);return}let h=document.createElement("div");h.className="feedback";for(let[x,N,U]of[["positive",t.helpful,"M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],["negative",t.notHelpful,"M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]]){let R=document.createElement("button");R.type="button",R.className="icon-button",R.setAttribute("aria-label",N),R.appendChild(D(U,!0)),R.addEventListener("click",()=>{R.setAttribute("aria-pressed","true"),h.querySelectorAll("button").forEach(C=>{C!==R&&C.removeAttribute("aria-pressed")}),mt(i,x).then(C=>{C||R.removeAttribute("aria-pressed")})}),h.appendChild(R)}b&&h.appendChild(b),n.appendChild(h)}async function mt(n,i){try{return(await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feedback:{conversationId:a.conversationId,messageIndex:n,value:i}})})).ok}catch{return!1}}async function Z(n,i={}){let d=n.trim();if(!d&&a.staged.length===0||a.busy)return;V.hidden=!0,a.busy=!0,a.pickOne=!1,Q(),z?.recording&&z.cancel(),w.dataset.beforeDictation="";let b=a.staged;a.staged=[],he();let h={role:"user",content:d};b.length>0&&(h.attachments=b),i.show===!1&&(h.unseen=!0),a.messages.push(h),h.unseen||(re(h),v("message",{text:d})),a.suggestions=[],be(),a.controller=new AbortController,await ve(void 0,b),a.busy=!1,Q(),a.controller=null,J(),w.disabled||w.focus()}async function ve(n,i){let{bubble:d,wrapper:b}=re({role:"assistant",content:""});L.setAttribute("aria-busy","true");let h=document.createElement("span");h.className="typing",h.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),d.appendChild(h);let x=null,N="",U=S=>{N+=S,R(ft(N))},R=S=>{if(!C.content){if(!S){x?.remove(),x=null,d.contains(h)||d.appendChild(h);return}h.remove(),x??(x=document.createElement("div")),x.className="working",x.textContent=ue(t.working,{name:S}),d.contains(x)||d.appendChild(x),J()}},C={role:"assistant",content:""},O=[],q=[];if(await We(e.endpoint,{messages:a.messages,conversationId:a.conversationId,userId:e.userId,userHash:e.userHash,contact:e.contact,actionResults:n,...i&&i.length>0?{attachments:i}:{}},{onSources:S=>{O=S},onDelta:S=>{h.remove(),x?.remove(),x=null,C.content+=S,d.replaceChildren(oe(C.content)),J()},onError:S=>{h.remove(),x?.remove(),x=null,G(S),v("error",{message:S})},onFrame:S=>ht(S,q,R,U)},a.controller?.signal,t).finally(()=>{h.remove(),L.setAttribute("aria-busy","false")}),q.length>0&&!n){b.remove();let S=q.find(we=>we.payload?.form);if(S){xe={name:S.name,input:S.input};let we=Ue(S.payload?.form,He),de=document.createElement("div");de.className="msg",de.dataset.role="assistant",de.appendChild(we),L.appendChild(de),J();return}let wt=await vt(q);await ve(wt);return}if(C.content.trim()){let S=ct(O,C.content);C.sources=S.sources,C.citedAs=S.citedAs,a.messages.push(C),Oe(b,C.sources,C.citedAs),pt(b,a.messages.length-1,C.content),tt(e.endpoint,a.messages,e.persist!==!1),v("response",{text:C.content,sources:C.sources})}else b.remove();be()}function ft(n){let i=n.split(`
`).filter(b=>b.trim()),d=i[i.length-1]??"";return d.length>120?`${d.slice(-120).trimStart()}`:d}function gt(n){return n.replace(/[_-]+/g," ").trim()}function ht(n,i,d=()=>{},b=()=>{}){if(n.type==="client-action")i.push({id:n.id,name:n.name,input:n.input,payload:n.payload});else if(n.type==="suggestions")a.suggestions=n.items,a.pickOne=n.pickOne===!0&&n.items.length>0;else if(n.type==="reasoning")b(n.text);else if(n.type==="action")v("action",{name:n.name,status:n.status,...n.input?{input:n.input}:{},...n.result===void 0?{}:{result:n.result}}),d(n.status==="running"?n.summary??gt(n.name):null);else if(n.type==="captured")v("captured",{kind:n.kind,name:n.name,values:n.values});else if(n.type==="notice")ce(n.message);else if(n.type==="handoff")v("handoff",{ticketId:n.ticketId,message:n.message}),ce(n.message);else if(n.type==="ui"){let h=je({kind:n.kind,id:n.id,data:n.data},He);if(h){let x=n.id?[...L.children].find(U=>U.dataset?.uiId===n.id):void 0,N=document.createElement("div");N.className="msg",N.dataset.role="assistant",n.id&&(N.dataset.uiId=n.id),N.appendChild(h),x?x.replaceWith(N):(L.appendChild(N),J())}}}let He={submit:n=>{Z(n)},respond:n=>{bt(n)},run:async(n,i)=>{let d=p[n];if(!d)throw new Error("That is not available here");return d(i)}},xe=null;async function bt(n){let i=xe;xe=null,!(!i||a.busy)&&(a.busy=!0,Q(),a.controller=new AbortController,await ve([{name:i.name,input:i.input,output:n}]),a.busy=!1,Q(),a.controller=null)}async function vt(n){return Promise.all(n.map(async i=>{let d=p[i.name];if(!d)return{name:i.name,input:i.input,output:{error:"no handler registered on this page"}};try{return{name:i.name,input:i.input,output:await d(i.input)}}catch(b){return{name:i.name,input:i.input,output:{error:b instanceof Error?b.message:String(b)}}}}))}function xt(n,i){let d=document.createElement("div");d.className="attached";for(let b of i){if(b.mimeType.startsWith("image/")){let x=document.createElement("img");x.src=b.dataUrl,x.alt=b.name,d.appendChild(x);continue}let h=document.createElement("span");h.className="chip",h.textContent=b.name,d.appendChild(h)}n.appendChild(d)}function ce(n){let i=document.createElement("div");i.className="notice",i.textContent=n,L.appendChild(i),J()}function yt(){if(r||!e.invite||m.dataset.open==="true")return;try{if(sessionStorage.getItem(et(e.endpoint)))return}catch{}let n=document.createElement("div");n.className=`invite ${c}`,n.setAttribute("role","button"),n.tabIndex=0,n.appendChild(document.createTextNode(e.invite));let i=document.createElement("button");i.type="button",i.className="invite-dismiss",i.setAttribute("aria-label",t.dismiss),i.appendChild(D(j.close,!1));let d=()=>{n.remove();try{sessionStorage.setItem(et(e.endpoint),"1")}catch{}};i.addEventListener("click",h=>{h.stopPropagation(),d()});let b=()=>{d(),K(!0)};n.addEventListener("click",b),n.addEventListener("keydown",h=>{(h.key==="Enter"||h.key===" ")&&(h.preventDefault(),b())}),n.appendChild(i),s.appendChild(n)}if(e.invite&&!r){let n=e.inviteDelay??4e3,i=setTimeout(yt,n);g.push(i)}k.addEventListener("click",()=>K(m.dataset.open!=="true")),H.addEventListener("click",()=>K(!1)),_.addEventListener("click",()=>{typeof window.confirm=="function"&&!window.confirm(t.deleteConfirm)||Ie()}),ee.addEventListener("submit",n=>{n.preventDefault();let i=w.value;w.value="",w.style.height="auto",Z(i)}),w.addEventListener("input",()=>{w.style.height="auto",w.style.height=`${w.scrollHeight}px`}),w.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),ee.requestSubmit())}),s.addEventListener("keydown",n=>{n.key==="Escape"&&!r&&K(!1)}),fe(),le();let ye={open(n){let i=n?.ask?.trim();if(!i){K(!0);return}if(!n?.quietly){K(!0),Z(i);return}let d=ye.on("response",()=>{d(),K(!0)});Z(i,{show:!1})},close:()=>K(!1),ask:n=>Z(n),setOptions(n){Object.assign(M,n),n.suggestions&&(M.suggestions=[...n.suggestions],a.messages.length===0&&(a.suggestions=[...n.suggestions])),fe(),le()},resetOptions(n){let i=Object.keys(se).filter(d=>!n||n[d]);for(let d of i)d==="suggestions"?M.suggestions=[...se.suggestions]:M[d]=se[d];i.includes("suggestions")&&a.messages.length===0&&(a.suggestions=[...se.suggestions]),fe(),le()},on(n,i){let d=u.get(n)??new Set;return d.add(i),u.set(n,d),()=>d.delete(i)},handle(n,i){p[n]=i},clear(){De()},forget:()=>Ie(),destroy(){a.controller?.abort();for(let n of g)clearTimeout(n);o.remove()},element:o};return e.deepLink!==!1&&Ze(ye),ye}function en(e,t){if(t!=="auto"){e.setAttribute("data-theme",t);return}let r=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>e.setAttribute("data-theme",r.matches?"dark":"light");o(),r.addEventListener("change",o)}function tn(e){let t=Math.max(0,Math.floor((Date.now()-e)/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`}function D(e,t){let r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("viewBox","0 0 24 24"),r.setAttribute("aria-hidden","true"),r.setAttribute("fill",t?"currentColor":"none"),r.setAttribute("stroke",t?"none":"currentColor"),r.setAttribute("stroke-width","2"),r.setAttribute("stroke-linecap","round");let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",e),r.appendChild(o),r}function nn(e){try{let t=sessionStorage.getItem(nt(e));if(!t)return[];let r=JSON.parse(t);return Array.isArray(r)?r.filter(o=>{if(typeof o!="object"||o===null)return!1;let s=o;return(s.role==="user"||s.role==="assistant")&&typeof s.content=="string"}):[]}catch{return[]}}function tt(e,t,r){if(r)try{sessionStorage.setItem(nt(e),JSON.stringify(t.slice(-20)))}catch{}}function rn(e){return new Promise((t,r)=>{let o=new FileReader;o.onload=()=>t(String(o.result)),o.onerror=()=>r(new Error("unreadable")),o.readAsDataURL(e)})}function on(){let t=document.currentScript?.dataset??{},r=t.endpoint??window.recourseConfig?.endpoint;if(!r)return console.warn("[recourse] no data-endpoint on the script tag, widget not mounted"),null;let o=t.target?document.querySelector(t.target):null;return{endpoint:r,userId:t.userId,userHash:t.userHash,feedback:t.feedback!=="false",invite:t.invite,inviteDelay:t.inviteDelay?Number(t.inviteDelay):void 0,title:t.title,subtitle:t.subtitle,...t.footnote?{strings:{footnote:t.footnote}}:{},greeting:t.greeting,greetingArt:t.greetingArt,accent:t.accent,suggestions:t.suggestions?.split("|").map(s=>s.trim()).filter(Boolean),position:t.position==="bottom-left"?"bottom-left":"bottom-right",theme:t.theme==="dark"||t.theme==="light"?t.theme:"auto",open:t.open==="true",persist:t.persist!=="false",deepLink:t.deepLink!=="false",...an(t.attachments),...t.dictation==="true"?{dictation:{...t.dictationLang?{lang:t.dictationLang}:{},...t.dictationCloud==="true"?{allowCloudFallback:!0}:{}}}:{},...t.call?{call:t.callTransport==="hosted"?{endpoint:t.call,transport:"hosted"}:t.call}:{},copy:t.copy!=="false",allowDelete:t.delete==="true",...window.recourseConfig,...o?{target:o}:{}}}function an(e){if(!e||e==="false")return{};if(e==="true")return{attachments:!0};let t=Number(e);return Number.isFinite(t)&&t>0?{attachments:{maxBytes:Math.round(t*1024*1024)}}:{}}var ot=on();if(ot){let e=()=>{window.recourse=rt(ot)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e()}})();
