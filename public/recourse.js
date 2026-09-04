"use strict";(()=>{var Lt=/(\*\*[^*]+\*\*|`[^`]+`|!?\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g,Mt=/^(https?:|mailto:|\/|#)/i;function ae(e){let t=document.createDocumentFragment();for(let r of Rt(e))t.appendChild(Nt(r));return t}function Rt(e){let t=[],r=null,o=null,s=()=>{r&&r.lines.length>0&&t.push(r),r=null};for(let l of e.split(`
`)){if(/^\s*(```|~~~)/.test(l)){o?(t.push(o),o=null):(s(),o={kind:"code",lines:[]});continue}if(o){o.lines.push(l);continue}if(l.trim()===""){s();continue}let c=/^\s*[-*+]\s+(.*)$/.exec(l),a=/^\s*\d+[.)]\s+(.*)$/.exec(l),u=c?"ul":a?"ol":"p",h=c?.[1]??a?.[1]??l;(!r||r.kind!==u)&&(s(),r={kind:u,lines:[]}),r.lines.push(h)}return o&&t.push(o),s(),t}function Nt(e){if(e.kind==="code"){let r=document.createElement("pre"),o=document.createElement("code");return o.textContent=e.lines.join(`
`),r.appendChild(o),r}if(e.kind==="ul"||e.kind==="ol"){let r=document.createElement(e.kind);for(let o of e.lines){let s=document.createElement("li");s.appendChild(Ue(o)),r.appendChild(s)}return r}let t=document.createElement("p");return t.appendChild(Ue(e.lines.join(" "))),t}function Ue(e){let t=document.createDocumentFragment();for(let r of e.split(Lt)){if(!r)continue;if(r.startsWith("**")&&r.endsWith("**")){t.appendChild(ke("strong",r.slice(2,-2)));continue}if(r.startsWith("`")&&r.endsWith("`")){t.appendChild(ke("code",r.slice(1,-1)));continue}if(r.startsWith("*")&&r.endsWith("*")&&r.length>2){t.appendChild(ke("em",r.slice(1,-1)));continue}let o=/^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(r);if(o){let l=o[2];if(/^https:/i.test(l)){let c=document.createElement("img");c.src=l,c.alt=o[1],c.loading="lazy",c.className="md-image",t.appendChild(c)}else t.appendChild(document.createTextNode(o[1]));continue}let s=/^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(r);if(s){let l=s[2];if(Mt.test(l)){let c=document.createElement("a");c.textContent=s[1],c.href=l,c.target="_blank",c.rel="noopener noreferrer",t.appendChild(c)}else t.appendChild(document.createTextNode(s[1]));continue}t.appendChild(document.createTextNode(r))}return t}function ke(e,t){let r=document.createElement(e);return r.textContent=t,r}var Ee=/^(https?:|mailto:|tel:|\/|#)/i;function Ce(e,t){let r=e.showIf;if(r===void 0)return!0;if(typeof r=="boolean")return r;if(typeof r=="string"){let o=r.startsWith("!"),s=o?r.slice(1):r,[l,c]=s.split("=",2),a=t[(l??"").trim()],u=c===void 0?!!a:String(a)===c.trim();return o?!u:u}return!0}function I(e,t,r){let o=document.createElement(e);return o.textContent=t,r&&(o.className=r),o}function E(e){return typeof e=="string"?e:e==null?"":String(e)}function je(e,t,r,o=!1){if(!Ee.test(t))return I("span",e,r);let s=document.createElement("a");return s.textContent=e,s.href=t,o||(s.target="_blank"),s.rel="noopener noreferrer",s.className=r,s}var Ot=e=>{let t=E(e.label)||"Open",r=E(e.url);if(!r)return null;let o=document.createElement("div");return o.className="ui-actions",o.appendChild(je(t,r,"ui-button",e.sameTab===!0)),o};function It(e,t){let r=E(e.label);if(!r)return null;if(e.url)return je(r,E(e.url),"ui-button");let o=document.createElement("button");return o.type="button",o.className="ui-button",o.textContent=r,e.run?(o.addEventListener("click",async()=>{if(t.run){o.disabled=!0;try{await t.run(E(e.run),e.payload??{}),o.replaceWith(I("span",E(e.done)||"Done","ui-muted"))}catch(s){o.disabled=!1,o.textContent=s instanceof Error?s.message:"That did not work"}}}),o):(o.addEventListener("click",()=>t.submit(E(e.send)||r)),o)}var Dt=(e,t)=>{let r=document.createElement("div");if(r.className="ui-card",e.image&&Ee.test(E(e.image))){let c=document.createElement("img");c.src=E(e.image),c.alt=E(e.title),c.loading="lazy",c.className="ui-card-image",r.appendChild(c)}let o=document.createElement("div");o.className="ui-card-body",e.title&&o.appendChild(I("h3",E(e.title))),e.subtitle&&o.appendChild(I("p",E(e.subtitle),"ui-muted"));let s=(Array.isArray(e.fields)?e.fields:[]).filter(c=>Ce(c,e));if(s.length>0){let c=document.createElement("dl");c.className="ui-fields";for(let a of s){let u=a;c.appendChild(I("dt",E(u.label))),c.appendChild(I("dd",E(u.value)))}o.appendChild(c)}let l=(Array.isArray(e.actions)?e.actions:[]).filter(c=>Ce(c,e));if(l.length>0){let c=document.createElement("div");c.className="ui-actions";for(let a of l){let u=It(a,t);u&&c.appendChild(u)}c.childElementCount>0&&o.appendChild(c)}return r.appendChild(o),r},Ht=e=>{let t=(Array.isArray(e.columns)?e.columns:[]).map(E),r=Array.isArray(e.rows)?e.rows:[];if(t.length===0||r.length===0)return null;let o=document.createElement("div");o.className="ui-table-wrap";let s=document.createElement("table");s.className="ui-table";let l=document.createElement("thead"),c=document.createElement("tr");for(let u of t)c.appendChild(I("th",u));l.appendChild(c),s.appendChild(l);let a=document.createElement("tbody");for(let u of r.slice(0,25)){let h=document.createElement("tr"),p=Array.isArray(u)?u:t.map(y=>u[y]);for(let y of p)h.appendChild(I("td",E(y)));a.appendChild(h)}return s.appendChild(a),o.appendChild(s),o},Pt=(e,t)=>{let r=(Array.isArray(e.items)?e.items:[]).filter(s=>Ce(s,e));if(r.length===0)return null;let o=document.createElement("div");o.className="ui-list";for(let s of r){let l=s,c=E(l.title);if(!c)continue;let a=document.createElement(l.url?"a":"button");a.className="ui-list-item",a instanceof HTMLAnchorElement&&Ee.test(E(l.url))?(a.href=E(l.url),a.target="_blank",a.rel="noopener noreferrer"):a instanceof HTMLButtonElement&&(a.type="button",a.addEventListener("click",()=>t.submit(E(l.send)||c))),a.appendChild(I("span",c,"ui-list-title")),l.subtitle&&a.appendChild(I("span",E(l.subtitle),"ui-muted")),o.appendChild(a)}return o.childElementCount>0?o:null};function We(e,t){let r=document.createElement("form");r.className="ui-form",e.title&&r.appendChild(I("h3",e.title));let o=Array.isArray(e.fields)?e.fields:[],s=[];for(let a of o){let u=a,h=E(u.name);if(!h)continue;let p=document.createElement("label");p.className="ui-field",p.appendChild(I("span",E(u.label)||h));let y,A=Bt(u.groups);if(A||Array.isArray(u.options)&&u.options.length>0){let m=document.createElement("select");if(u.multiple===!0&&(m.multiple=!0),A)for(let[f,x]of A){let S=document.createElement("optgroup");S.label=f;for(let T of x)S.appendChild(Be(T));m.appendChild(S)}else for(let f of u.options)m.appendChild(Be(E(f)));y=m}else if(u.type==="boolean"){let m=document.createElement("input");m.type="checkbox",y=m}else if(u.input==="multiline"){let m=document.createElement("textarea");m.rows=3,u.placeholder&&(m.placeholder=E(u.placeholder)),y=m}else{let m=document.createElement("input");m.type=Ut(u.input,u.type),u.placeholder&&(m.placeholder=E(u.placeholder)),y=m}y.name=h,u.required!==!1&&y instanceof HTMLTextAreaElement&&(y.required=!0),u.required!==!1&&y instanceof HTMLSelectElement&&y.multiple&&(y.required=!0),u.required!==!1&&y instanceof HTMLInputElement&&y.type!=="checkbox"&&(y.required=!0),jt(y,u),p.appendChild(y),r.appendChild(p),s.push({name:h,element:y})}let l=document.createElement("button");l.type="submit",l.className="ui-button",l.textContent=e.submitLabel||"Send",r.appendChild(l);let c=!1;return r.addEventListener("submit",a=>{if(a.preventDefault(),c)return;c=!0;let u={};for(let{name:h,element:p}of s)u[h]=Wt(p);r.replaceChildren(ae("Thanks, sending that now.")),t.respond(u)}),r}var Ft=e=>{let t=(Array.isArray(e.points)?e.points:[]).map(l=>l).map(l=>({label:E(l.label),value:_t(l.value),display:E(l.display)})).filter(l=>l.label!==""&&l.value!==null).slice(0,12);if(t.length===0)return null;let r=document.createElement("div");r.className="ui-chart",e.title&&r.appendChild(I("h3",E(e.title)));let o=Math.max(...t.map(l=>Math.max(l.value,0)),0),s=document.createElement("dl");s.className="ui-chart-rows";for(let l of t){s.appendChild(I("dt",l.label));let c=document.createElement("dd"),a=document.createElement("div");a.className="ui-chart-track";let u=document.createElement("div");u.className="ui-chart-bar",u.style.width=`${o<=0?0:Math.max(l.value,0)/o*100}%`,a.appendChild(u),c.appendChild(a),c.appendChild(I("span",l.display||String(l.value))),s.appendChild(c)}return r.appendChild(s),r},zt={button:Ot,card:Dt,table:Ht,list:Pt,chart:Ft};function _e(e,t){let r=zt[e.kind];return r?r(e.data,t):null}function Ut(e,t){return e==="date"||e==="email"||e==="tel"?e:t==="number"?"number":"text"}function Be(e){let t=document.createElement("option");return t.value=e,t.textContent=e,t}function Bt(e){if(!e||typeof e!="object"||Array.isArray(e))return null;let t=Object.entries(e).map(([r,o])=>[r,(Array.isArray(o)?o:[]).map(s=>E(s)).filter(Boolean)]).filter(([,r])=>r.length>0);return t.length>0?t:null}function jt(e,t){let r=E(t.invalidMessage);if(e instanceof HTMLSelectElement||(typeof t.pattern=="string"&&t.pattern&&e instanceof HTMLInputElement&&(e.pattern=t.pattern),typeof t.minLength=="number"&&(e.minLength=t.minLength),typeof t.maxLength=="number"&&(e.maxLength=t.maxLength),e instanceof HTMLInputElement&&e.type==="number"&&(typeof t.min=="number"&&(e.min=String(t.min)),typeof t.max=="number"&&(e.max=String(t.max))),!r))return;let o=()=>e.setCustomValidity(e.validity.valid?"":r);e.addEventListener("input",()=>{e.setCustomValidity(""),o()}),e.addEventListener("invalid",o)}function Wt(e){return e instanceof HTMLInputElement&&e.type==="checkbox"?e.checked:e instanceof HTMLSelectElement&&e.multiple?[...e.selectedOptions].map(t=>t.value):e.value}function _t(e){if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?t:null}var $t={offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status})."};async function $e(e,t,r,o,s=$t){let l;try{l=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,messages:t.messages.map(h=>({role:h.role,content:h.content}))}),signal:o})}catch{r.onError?.(s.offline);return}if(!l.ok||!l.body){r.onError?.(l.status===429?s.rateLimited:s.unavailable.replace("{status}",String(l.status)));return}let c=l.body.getReader(),a=new TextDecoder,u="";for(;;){let{done:h,value:p}=await c.read();if(h)break;u+=a.decode(p,{stream:!0});let y=u.split(`

`);u=y.pop()??"";for(let A of y){let m=A.split(`
`).find(x=>x.startsWith("data:"));if(!m)continue;let f;try{f=JSON.parse(m.slice(5).trim())}catch{continue}r.onFrame?.(f),f.type==="sources"?r.onSources?.(f.sources):f.type==="delta"?r.onDelta?.(f.text):f.type==="done"?r.onDone?.():f.type==="error"&&r.onError?.(f.message)}}r.onDone?.()}function qt(e=globalThis){let t=e;return t.SpeechRecognition??t.webkitSpeechRecognition??null}var Vt={"not-allowed":"I need permission to use the microphone. You can allow it in your browser settings.","service-not-allowed":"Your browser would not let me use speech recognition.","no-speech":"I did not hear anything. Try again?","audio-capture":"I could not find a microphone.",network:"Speech recognition needs a connection and could not reach it.","language-not-supported":"Speech recognition is not available for this language on your device."};function qe(e={},t=globalThis){let r=qt(t);if(!r)return null;let o=r,s=null,l=!1;function c(h){let p=new o;p.continuous=!0,p.interimResults=!0,p.maxAlternatives=1;let y=e.lang??Kt(t);return y&&(p.lang=y),h&&(p.processLocally=!0),p}function a(h){h.onstart=()=>e.onStateChange?.(!0),h.onresult=p=>{let y="";for(let A=p.resultIndex;A<p.results.length;A++){let m=p.results[A];if(!m)continue;let f=m[0]?.transcript??"";m.isFinal?e.onFinal?.(f):y+=f}y&&e.onInterim?.(y)},h.onerror=p=>{let y=e.processLocally!==!1,A=p.error==="language-not-supported"||p.error==="service-not-allowed";if(y&&A&&e.allowCloudFallback&&!l){l=!0,s=null,u(!1);return}p.error!=="aborted"&&e.onError?.(Vt[p.error]??"Speech recognition stopped unexpectedly.")},h.onend=()=>{s=null,e.onStateChange?.(!1)}}function u(h){let p=c(h);a(p),s=p;try{p.start()}catch{s=null,e.onStateChange?.(!1)}}return{get recording(){return s!==null},start(){s||(l=!1,u(e.processLocally!==!1))},stop(){s?.stop()},cancel(){let h=s;s=null,h?.abort(),e.onStateChange?.(!1)},toggle(){s?this.stop():this.start()}}}function Kt(e){return e.document?.documentElement?.lang??""}function Ke(e){let t=e.fetch??globalThis.fetch.bind(globalThis),r=e.load??Gt,o="idle",s=null,l=0,c=p=>{o!==p&&(o=p,e.onStateChange?.(p))},a=p=>{c("failed"),e.onError?.(p)};async function u(){if(o==="connecting"||o==="live")return;let p=++l;c("connecting");let y;try{let m=await t(e.endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({conversationId:e.conversationId()})});if(m.status===429){p===l&&a("Too many calls just now. Try again in a moment.");return}if(!m.ok){p===l&&a("Calling is not available right now.");return}let f=await m.json();if(typeof f.signedUrl!="string"||!f.signedUrl){p===l&&a("Calling is not available right now.");return}y=f.signedUrl}catch{p===l&&a("Could not reach the server to start the call.");return}if(p!==l)return;let A;try{A=await r()}catch{p===l&&a("Could not load the voice connection.");return}if(p===l)try{let m=await A.startSession({signedUrl:y,onConnect:()=>{p===l&&c("live")},onDisconnect:()=>{p===l&&(s=null,c("ended"))},onError:()=>{p===l&&a("The call ended unexpectedly. Your microphone may be blocked.")},onMessage:f=>{let x=typeof f?.message=="string"?f.message.trim():"";x&&e.onTranscript?.({role:f.source==="user"?"visitor":"agent",text:x})}});if(p!==l){await Promise.resolve(m.endSession()).catch(()=>{});return}s=m}catch{p===l&&a("Could not start the call. Your microphone may be blocked.")}}async function h(){l++;let p=s;if(s=null,p)try{await p.endSession()}catch{}c(o==="failed"?"failed":"ended")}return{get state(){return o},start:u,stop:h,async toggle(){o==="connecting"||o==="live"?await h():await u()}}}var Ve="https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";async function Gt(){if(!Ve)throw new Error("this build does not fetch a voice runtime; pass call.load with your own");let t=await import(Ve);if(!t.Conversation)throw new Error("no conversation runtime in the loaded module");return t.Conversation}function Ge(e,t,r=16e3){if(r>=t||e.length===0)return e;let o=t/r,s=new Float32Array(Math.floor(e.length/o));for(let l=0;l<s.length;l++){let c=Math.floor(l*o),a=Math.min(e.length,Math.floor((l+1)*o)),u=0;for(let h=c;h<a;h++)u+=e[h];s[l]=a>c?u/(a-c):0}return s}function Je(e){let t=new Int16Array(e.length);for(let r=0;r<e.length;r++){let o=Math.max(-1,Math.min(1,e[r]));t[r]=o<0?o*32768:o*32767}return t}function Ye(e){if(e.length===0)return 0;let t=0;for(let r of e)t+=r*r;return Math.min(1,Math.sqrt(t/e.length)/32768)}var Yt=`
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
`,Xt={echoCancellation:!0,noiseSuppression:!0,autoGainControl:!0,channelCount:1},Qt=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4"];function Ae(){let e=globalThis.MediaRecorder;return e?.isTypeSupported?Qt.find(t=>e.isTypeSupported?.(t))??null:null}async function Xe(e){let t=e.frameMs??20,{context:r,stream:o}=await(e.open??en)(),s=Math.round(r.sampleRate*t/1e3),l=r.createMediaStreamSource(o),c=URL.createObjectURL(new Blob([Yt],{type:"application/javascript"}));try{await r.audioWorklet.addModule(c)}finally{URL.revokeObjectURL(c)}let a=new AudioWorkletNode(r,"recourse-capture",{numberOfInputs:1,numberOfOutputs:0,processorOptions:{frameSamples:s}});a.port.onmessage=h=>{let p=Ge(h.data,r.sampleRate,16e3);e.onFrame(Je(p))},l.connect(a);let u=null;if(e.onCompressed){let h=Ae();if(h){let p=!0;u=(e.record??Zt)(o,h,e.chunkMs??200,y=>{let A=p;p=!1,y.size!==0&&y.arrayBuffer().then(m=>e.onCompressed?.(m,A))})}}return{async stop(){a.port.onmessage=null,u?.stop(),l.disconnect(),a.disconnect();for(let h of o.getTracks())h.stop();await r.close()}}}function Zt(e,t,r,o){let s=new MediaRecorder(e,{mimeType:t});return s.ondataavailable=l=>o(l.data),s.start(r),{stop:()=>{try{s.state!=="inactive"&&s.stop()}catch{}}}}async function en(){let e=await navigator.mediaDevices.getUserMedia({audio:Xt});return{context:new AudioContext,stream:e}}function Qe(e){let t=e.cushionSeconds??.05,r=0;return{get endsAt(){return r},get playing(){return r>e.now()},push(o){if(o.length===0)return;let s=e.now(),l=r>s?r:s+t;e.play(o,l),r=l+o.length/e.sampleRate},clear(){r=0}}}function Ze(e){let t="idle",r=null,o=null,s=null,l=null,c=0,a=f=>{t!==f&&(t=f,e.onStateChange?.(f))},u=f=>{a("failed"),e.onError?.(f)};async function h(){let f=o,x=s,S=r;o=null,s=null,l=null,r=null;try{S?.close()}catch{}await f?.stop().catch(()=>{}),x?.stop(),await x?.close().catch(()=>{})}async function p(){if(t==="connecting"||t==="live")return;let f=++c;a("connecting");let x;try{x=(e.connect??nn)(tn(e.endpoint))}catch{f===c&&u("Could not reach the server to start the call.");return}x.binaryType="arraybuffer",r=x,x.onopen=()=>{if(f!==c){x.close();return}let S=e.compress===!1?null:Ae();x.send(JSON.stringify({type:"hello",sampleRate:16e3,conversationId:e.conversationId(),...S?{audio:{mimeType:S}}:{}})),y(f,x,S)},x.onmessage=S=>{if(f===c){if(typeof S.data=="string"){let T;try{T=JSON.parse(S.data)}catch{return}T.type==="transcript"&&T.text&&T.role&&e.onTranscript?.({role:T.role,text:T.text}),T.type==="interrupted"&&(s?.stop(),l?.clear()),T.type==="error"&&e.onError?.(T.message??"Something went wrong.");return}S.data instanceof ArrayBuffer&&A(f,S.data)}},x.onerror=()=>{f===c&&(h(),u("The call was cut off."))},x.onclose=()=>{f===c&&(h(),(t==="live"||t==="connecting")&&a("ended"))}}async function y(f,x,S){try{s=(e.audio??rn)(),l=Qe({now:s.now,play:s.play,sampleRate:s.sampleRate});let T=[],$=()=>{T.length===0||!Se(x)||(x.send(JSON.stringify({type:"levels",values:T,frameMs:20})),T=[])};if(o=await(e.microphone??Xe)({onFrame:P=>{if(!(f!==c||!Se(x))){if(S){T.push(Ye(P)),T.length>=5&&$();return}x.send(P)}},...S?{onCompressed:P=>{f!==c||!Se(x)||($(),x.send(P))}}:{}}),f!==c){await h();return}a("live")}catch{if(f!==c)return;await h(),u("Could not use your microphone. It may be blocked for this site.")}}async function A(f,x){try{let S=await s?.decode(x);if(f!==c||!S)return;l?.push(S)}catch{}}async function m(){c++,await h(),a(t==="failed"?"failed":"ended")}return{get state(){return t},start:p,stop:m,async toggle(){t==="connecting"||t==="live"?await m():await p()}}}function Se(e){return e.readyState===1||e.readyState==="open"}function tn(e){if(/^wss?:\/\//i.test(e))return e;let t=new URL(e,location.href);return t.protocol=t.protocol==="https:"?"wss:":"ws:",t.toString()}function nn(e){return new WebSocket(e)}function rn(){let e=new AudioContext,t=[];return{sampleRate:e.sampleRate,now:()=>e.currentTime,decode:async r=>(await e.decodeAudioData(r)).getChannelData(0),play:(r,o)=>{let s=e.createBuffer(1,r.length,e.sampleRate);s.getChannelData(0).set(r);let l=e.createBufferSource();l.buffer=s,l.connect(e.destination),l.onended=()=>{t=t.filter(c=>c!==l)},l.start(o),t.push(l)},stop:()=>{for(let r of t)try{r.stop()}catch{}t=[]},close:()=>e.close()}}var et=`
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

.ui-chart { display: flex; flex-direction: column; gap: 8px; }
.ui-chart h3 { margin: 0; font-size: 14.5px; font-weight: 620; }
.ui-chart-rows {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: 6px 10px;
  margin: 0;
  font-size: 13px;
}
.ui-chart-rows dt { color: var(--rc-muted); overflow-wrap: anywhere; }
.ui-chart-rows dd { margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0; }
/* A minimum width so a value near zero is still a mark rather than nothing,
   which reads as missing data. */
.ui-chart-track { flex: 1; min-width: 0; }
.ui-chart-bar {
  height: 10px;
  min-width: 2px;
  border-radius: 999px;
  background: var(--rc-accent);
}
.ui-chart-rows dd span { white-space: nowrap; color: var(--rc-ink); }

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
`;var tt={title:"Ask us anything",open:"Open the support chat",close:"Close the support chat",placeholder:"Type your question",choosePlaceholder:"Choose one of the options above",retry:"Try answering again",send:"Send",inputLabel:"Your question",attach:"Attach a file",removeFile:"Remove {name}",dictate:"Dictate your question",stopDictating:"Stop dictating",listening:"Listening, press again to stop",call:"Talk to us",endCall:"End the call",calling:"Connecting, this can take a few seconds",onCall:"On a call \xB7 {time}",callAgain:"Call again, the last call failed",callStarted:"Call started",callEnded:"Call ended",working:"Checking {name}",helpful:"This helped",notHelpful:"This did not help",thanks:"Thanks, that helps us improve.",copy:"Copy this answer",copied:"Copied",deleteConversation:"Delete this conversation",deleteConfirm:"Delete this conversation? It cannot be brought back.",offline:"Could not reach the assistant. Check your connection.",rateLimited:"Too many messages just now. Give it a moment.",unavailable:"The assistant is unavailable ({status}).",submit:"Send",submitted:"Thanks, sending that now.",dismiss:"Dismiss"};function nt(e){if(!e)return tt;let t={...tt};for(let[r,o]of Object.entries(e))typeof o=="string"&&o.trim().length>0&&(t[r]=o);return t}function ge(e,t){return e.replace(/\{(\w+)\}/g,(r,o)=>o in t?String(t[o]):r)}var on=["recourse_q","rc_q"];function an(e={}){let t=e.params??on,r;try{r=new URL(e.href??window.location.href)}catch{return null}let o=null;for(let s of t){let l=r.searchParams.get(s);if(l&&l.trim()){o=l.trim().slice(0,1e3);break}}if(o===null)return null;if(e.strip!==!1){for(let s of t)r.searchParams.delete(s);try{window.history.replaceState(window.history.state,"",r.toString())}catch{}}return o}function rt(e,t={}){let r=an(t);return r===null?null:(e.open(),e.ask(r),r)}function at(e){return`recourse:transcript:${e}`}function ot(e){return`recourse:invite:${e}`}var B={chat:"M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",close:"M6 6l12 12M18 6L6 18",send:"M4 12l16-8-6 8 6 8z",clip:"M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",mic:"M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",phone:"M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",hangUp:"M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"},sn=["image/png","image/jpeg","image/webp","image/gif","application/pdf","text/plain","text/markdown","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];function st(e){if(!e.endpoint)throw new Error("recourse: an `endpoint` is required");let t=nt(e.strings),r=!!e.target,o=document.createElement("div");o.setAttribute("data-recourse",""),r&&o.setAttribute("data-inline","true"),o.style.cssText=r?"display:block;width:100%;height:100%":"";let s=o.attachShadow({mode:"open"}),l=document.createElement("style");l.textContent=et,s.appendChild(l),e.accent&&o.style.setProperty("--rc-accent",e.accent),ln(o,e.theme??"auto");let c=e.position==="bottom-left"?"pos-left":"pos-right",a={messages:e.persist===!1?[]:dn(e.endpoint),busy:!1,controller:null,conversationId:`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,suggestions:[...e.suggestions??[]],pickOne:!1,staged:[]},u={...e.actions},h=[],p=new Map;function y(n,i){for(let d of p.get(n)??[])try{d(i)}catch(g){console.error(`[recourse] listener for "${n}" threw`,g)}}let A=document.createElement("button");A.className=`launcher ${c}`,A.type="button",A.setAttribute("aria-label",t.open),A.setAttribute("aria-expanded","false"),A.appendChild(D(B.chat,!0));let m=document.createElement("div");m.className=`panel ${c}`,m.setAttribute("role","dialog"),m.setAttribute("aria-modal","false"),m.setAttribute("aria-label",e.title??t.title),m.dataset.open=String(r||e.open===!0);let f=document.createElement("div");f.className="header";let x=document.createElement("div");x.className="grow";let S=document.createElement("h2");x.appendChild(S);let T=document.createElement("p");x.appendChild(T),f.appendChild(x);let $=document.createElement("button");$.className="icon-button",$.type="button",$.setAttribute("aria-label",t.deleteConversation),$.appendChild(D("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z",!1)),e.allowDelete&&f.appendChild($);let P=document.createElement("button");P.className="icon-button",P.type="button",P.setAttribute("aria-label",t.close),P.appendChild(D(B.close,!1)),r||f.appendChild(P);let M=document.createElement("div");M.className="log",M.setAttribute("role","log"),M.setAttribute("aria-live","polite"),M.setAttribute("aria-relevant","additions text"),M.setAttribute("aria-live","polite"),M.setAttribute("aria-relevant","additions text");let se=document.createElement("div");se.className="suggestions";let V=document.createElement("div");V.className="error",V.hidden=!0,V.setAttribute("role","alert");let ne=document.createElement("form");ne.className="composer";let w=document.createElement("textarea");w.setAttribute("dir","auto"),w.rows=1,w.placeholder=t.placeholder,w.setAttribute("aria-label",t.inputLabel);let re=document.createElement("button");re.type="submit",re.setAttribute("aria-label",t.send),re.appendChild(D(B.send,!0));let F=e.attachments?{maxBytes:(typeof e.attachments=="object"?e.attachments.maxBytes:void 0)??10*1024*1024,maxCount:(typeof e.attachments=="object"?e.attachments.maxCount:void 0)??4,accept:(typeof e.attachments=="object"?e.attachments.accept:void 0)??sn}:null,Z=document.createElement("div");Z.className="tray",Z.hidden=!0;let z=document.createElement("input");z.type="file",z.multiple=!0,z.hidden=!0,z.tabIndex=-1;let ee=document.createElement("button");ee.type="button",ee.className="attach",ee.setAttribute("aria-label",t.attach),ee.appendChild(D(B.clip,!1));let Te=e.dictation?typeof e.dictation=="object"?e.dictation:{}:null,j=document.createElement("button");j.type="button",j.className="mic",j.setAttribute("aria-label",t.dictate),j.appendChild(D(B.mic,!1));let U=null,Le=!1,Me;F&&(z.accept=F.accept.join(",")),Te&&(U=qe({...Te,onStateChange:n=>{j.dataset.recording=String(n),j.setAttribute("aria-label",n?t.stopDictating:t.dictate),j.setAttribute("aria-pressed",String(n)),j.replaceChildren(n?Object.assign(document.createElement("span"),{className:"stop"}):D(B.mic,!1)),n?oe("listening",t.listening):Le||oe(null),n||(w.dataset.interim="")},onInterim:n=>{w.value=`${w.dataset.beforeDictation??""}${n}`},onFinal:n=>{let i=w.dataset.beforeDictation??"",d=i&&!i.endsWith(" ")?`${i} ${n}`:`${i}${n}`;w.value=d,w.dataset.beforeDictation=d},onError:n=>X(n)}),U&&(j.addEventListener("click",()=>{U&&(U.recording||(w.dataset.beforeDictation=w.value),U.toggle(),w.focus())}),w.addEventListener("keydown",n=>{n.key==="Escape"&&U?.recording&&(n.preventDefault(),w.value=w.dataset.beforeDictation??"",U.cancel())})));let Re=typeof e.call=="string"?e.call:e.call?e.call.endpoint:null,Ne=typeof e.call=="object"?e.call.load:void 0,ct=typeof e.call=="object"?e.call.transport:void 0,W=document.createElement("button");W.type="button",W.className="call",W.setAttribute("aria-label",t.call),W.appendChild(D(B.phone,!1));let he=null;if(Re){let n={endpoint:Re,conversationId:()=>a.conversationId,onStateChange:i=>dt(i),onTranscript:({role:i,text:d})=>{ie({role:i==="visitor"?"user":"assistant",content:d})},onError:i=>X(i)};he=ct==="hosted"?Ze(n):Ke({...n,...Ne?{load:Ne}:{}}),W.addEventListener("click",()=>{he?.toggle()})}function dt(n){W.dataset.state=n;let i=n==="live"||n==="connecting",d=n==="failed";if(W.setAttribute("aria-label",i?t.endCall:d?t.callAgain:t.call),W.replaceChildren(D(i?B.hangUp:B.phone,!1)),d&&W.appendChild(Object.assign(document.createElement("span"),{className:"failed"})),clearInterval(Me),n==="live"){let g=Date.now(),b=()=>oe("live",ge(t.onCall,{time:cn(g)}));b(),Me=setInterval(b,1e3)}else n==="connecting"?oe("connecting",t.calling):U?.recording||oe(null);Le=i,n==="live"&&pe(t.callStarted),n==="ended"&&pe(t.callEnded)}let ut=U?[j]:[],pt=he?[W]:[];ne.append(...F?[ee]:[],w,...ut,...pt,re);let le=document.createElement("p");le.className="footnote";let _=document.createElement("p");_.className="status",_.setAttribute("role","status"),_.setAttribute("aria-live","polite"),_.hidden=!0,_.append(Object.assign(document.createElement("span"),{className:"dot"}));let be=document.createElement("span");_.appendChild(be);function oe(n,i=""){if(_.hidden=n===null,n===null){be.textContent="",_.removeAttribute("data-kind");return}_.dataset.kind=n,be.textContent=i}m.append(f,M,se,V,Z,ne,_,le),F&&m.appendChild(z),r?s.append(m):s.append(A,m),(e.target??document.body).appendChild(o),F&&(ee.addEventListener("click",()=>z.click()),z.addEventListener("change",()=>{z.files&&ye(z.files),z.value=""}),m.addEventListener("dragover",n=>{n.dataTransfer?.types.includes("Files")&&(n.preventDefault(),m.dataset.dropping="true")}),m.addEventListener("dragleave",()=>{delete m.dataset.dropping}),m.addEventListener("drop",n=>{n.dataTransfer?.files.length&&(n.preventDefault(),delete m.dataset.dropping,ye(n.dataTransfer.files))}),w.addEventListener("paste",n=>{let i=Array.from(n.clipboardData?.files??[]);i.length!==0&&(n.preventDefault(),ye(i))}));let R={title:e.title??t.title,subtitle:e.subtitle??"",placeholder:t.placeholder,footnote:t.footnote??"",greeting:e.greeting??"",suggestions:[...e.suggestions??[]]},Y={...R,suggestions:[...R.suggestions]};function Oe(n){De(),n.suggestions&&ce(),n.greeting!==void 0&&a.messages.length===0&&de()}function Ie(){return(Array.isArray(R.greeting)?R.greeting:[R.greeting]).map(i=>i.trim()).filter(Boolean)}function De(){S.textContent=R.title,m.setAttribute("aria-label",R.title),T.textContent=R.subtitle,T.hidden=R.subtitle==="",le.textContent=R.footnote,le.hidden=R.footnote==="",J()}function K(n){y(n?"open":"close",{}),n&&s.querySelector(".invite")?.remove(),m.dataset.open=String(n),A.setAttribute("aria-expanded",String(n)),A.setAttribute("aria-label",n?t.close:t.open),n?w.focus():A.focus()}function X(n){V.textContent=n,V.hidden=!1}async function ye(n){if(F){V.hidden=!0;for(let i of Array.from(n)){if(a.staged.length>=F.maxCount){X(`You can attach ${F.maxCount} files at a time.`);break}let d=(i.type||"").split(";")[0]?.trim().toLowerCase()??"";if(!F.accept.includes(d)){X(`${i.name} is not a file type we can read.`);continue}if(i.size>F.maxBytes){X(`${i.name} is larger than ${Math.round(F.maxBytes/1024/1024)}MB.`);continue}let g;try{g=await un(i)}catch{X(`${i.name} could not be read.`);continue}a.staged.push({name:i.name,mimeType:d,dataUrl:g,bytes:i.size})}ve()}}function ve(){Z.replaceChildren(),Z.hidden=a.staged.length===0;for(let[n,i]of a.staged.entries()){let d=document.createElement("span");d.className="chip";let g=document.createElement("span");g.textContent=i.name,d.appendChild(g);let b=document.createElement("button");b.type="button",b.setAttribute("aria-label",ge(t.removeFile,{name:i.name})),b.appendChild(D(B.close,!1)),b.addEventListener("click",()=>{a.staged.splice(n,1),ve(),w.focus()}),d.appendChild(b),Z.appendChild(d)}}function G(){M.scrollTop=M.scrollHeight}function mt(n,i){let d=new Set;for(let v of i.matchAll(/\[(\d{1,2})\]/g))d.add(Number.parseInt(v[1],10)-1);let g=n.map((v,H)=>({ref:v,position:H})),b=g.filter(v=>d.has(v.position)),k=b.length>0?b:g,C=b.length>0,N=new Map,q=[],O=[];for(let v of k){let H=`${v.ref.url??""}|${v.ref.title}|${v.ref.section??""}`,Q=N.get(H);if(Q!==void 0){C&&O[Q]?.push(v.position+1);continue}N.set(H,q.length),q.push(v.ref),O.push(C?[v.position+1]:[])}return{sources:q,citedAs:O}}function He(n,i,d=[]){if(i.length===0)return;let g=document.createElement("div");g.className="sources";for(let[b,k]of i.slice(0,4).entries()){let C=k.section?`${k.title} \xB7 ${k.section}`:k.title,N=d[b]??[],q=N.length>0?`${N.map(v=>`[${v}]`).join(" ")} ${C}`:C,O=document.createElement(k.url?"a":"span");O.textContent=q,k.url&&O instanceof HTMLAnchorElement&&(O.href=k.url,O.target="_blank",O.rel="noopener noreferrer"),g.appendChild(O)}n.appendChild(g)}function ie(n){M.querySelector(".empty")?.remove();let i=document.createElement("div");i.className="msg",i.dataset.role=n.role;let d=document.createElement("div");return d.className="bubble",d.setAttribute("dir","auto"),n.role==="user"?d.textContent=n.content:d.appendChild(ae(n.content)),n.role==="user"&&!n.content&&n.attachments?.length?d.remove():i.appendChild(d),n.attachments?.length&&At(i,n.attachments),n.sources&&He(i,n.sources,n.citedAs),M.appendChild(i),G(),{bubble:d,wrapper:i}}function ce(){if(se.replaceChildren(),J(),a.suggestions.length!==0)for(let n of a.suggestions.slice(0,4)){let i=document.createElement("button");i.type="button",i.textContent=n,i.addEventListener("click",()=>{te(n)}),se.appendChild(i)}}function J(){let n=a.busy||a.pickOne;w.disabled=a.pickOne,w.placeholder=a.pickOne?t.choosePlaceholder:R.placeholder,re.disabled=n}function de(){if(M.replaceChildren(),e.greetingArt&&a.messages.length===0)ft();else for(let n of Ie())ie({role:"assistant",content:n});for(let n of a.messages)n.unseen||ie(n);ce()}function ft(){let n=document.createElement("div");n.className="empty";let i=document.createElement("img");i.src=e.greetingArt,i.alt="",i.decoding="async",n.appendChild(i);for(let d of Ie()){let g=document.createElement("p");g.textContent=d,n.appendChild(g)}M.appendChild(n)}function gt(n){if(e.copy===!1||typeof navigator>"u"||!navigator.clipboard?.writeText)return;let i=document.createElement("button");return i.type="button",i.className="icon-button",i.setAttribute("aria-label",t.copy),i.appendChild(D("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z",!0)),i.addEventListener("click",()=>{navigator.clipboard.writeText(n).then(()=>{i.setAttribute("aria-label",t.copied),i.setAttribute("data-copied","true"),setTimeout(()=>{i.setAttribute("aria-label",t.copy),i.removeAttribute("data-copied")},1600)}).catch(()=>{})}),i}function Pe(){a.messages=[],a.suggestions=[...R.suggestions],a.pickOne=!1,a.conversationId=`c_${Date.now().toString(36)}${Math.random().toString(36).slice(2,10)}`,it(e.endpoint,[],e.persist!==!1),de()}async function Fe(){let n=a.conversationId;Pe();try{await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({deleteConversation:n})})}catch{}}function ht(n,i,d="",g=!1){let b=gt(d),k=g&&e.retry!==!1?bt():null;if(e.feedback===!1){if(!b&&!k)return;let N=document.createElement("div");N.className="feedback",b&&N.appendChild(b),k&&N.appendChild(k),n.appendChild(N);return}let C=document.createElement("div");C.className="feedback";for(let[N,q,O]of[["positive",t.helpful,"M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],["negative",t.notHelpful,"M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]]){let v=document.createElement("button");v.type="button",v.className="icon-button",v.setAttribute("aria-label",q),v.appendChild(D(O,!0)),v.addEventListener("click",()=>{v.setAttribute("aria-pressed","true"),C.querySelectorAll("button").forEach(H=>{H!==v&&H.removeAttribute("aria-pressed")}),vt(i,N).then(H=>{H||v.removeAttribute("aria-pressed")})}),C.appendChild(v)}b&&C.appendChild(b),k&&C.appendChild(k),n.appendChild(C)}function bt(){for(let i of M.querySelectorAll("[data-retry]"))i.remove();let n=document.createElement("button");return n.type="button",n.className="icon-button",n.setAttribute("aria-label",t.retry),n.dataset.retry="true",n.appendChild(D("M17.65 6.35A8 8 0 104 12h2a6 6 0 1110.24 4.24L13 13h7v7l-2.35-2.35A8 8 0 0017.65 6.35z",!0)),n.addEventListener("click",()=>{yt()}),n}async function yt(){if(a.busy)return;let n=a.messages[a.messages.length-1];if(!n||n.role!=="assistant")return;a.busy=!0,a.pickOne=!1,J(),a.messages.pop(),a.suggestions=[],de();let i=a.messages[a.messages.length-1],d=i?.role==="user"?i.attachments:void 0;a.controller=new AbortController,await ue(void 0,d,!0),a.busy=!1,J(),a.controller=null,G()}async function vt(n,i){try{return(await fetch(e.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({feedback:{conversationId:a.conversationId,messageIndex:n,value:i}})})).ok}catch{return!1}}async function te(n,i={}){let d=n.trim();if(!d&&a.staged.length===0||a.busy)return;V.hidden=!0,a.busy=!0,a.pickOne=!1,J(),U?.recording&&U.cancel(),w.dataset.beforeDictation="";let g=a.staged;a.staged=[],ve();let b={role:"user",content:d};g.length>0&&(b.attachments=g),i.show===!1&&(b.unseen=!0),a.messages.push(b),b.unseen||(ie(b),y("message",{text:d})),a.suggestions=[],ce(),a.controller=new AbortController,await ue(void 0,g),a.busy=!1,J(),a.controller=null,G(),w.disabled||w.focus()}async function ue(n,i,d=!1){let{bubble:g,wrapper:b}=ie({role:"assistant",content:""});M.setAttribute("aria-busy","true");let k=document.createElement("span");k.className="typing",k.append(document.createElement("i"),document.createElement("i"),document.createElement("i")),g.appendChild(k);let C=null,N="",q=L=>{N+=L,O(xt(N))},O=L=>{if(!v.content){if(!L){C?.remove(),C=null,g.contains(k)||g.appendChild(k);return}k.remove(),C??(C=document.createElement("div")),C.className="working",C.textContent=ge(t.working,{name:L}),g.contains(C)||g.appendChild(C),G()}},v={role:"assistant",content:""},H=[],Q=[];if(await $e(e.endpoint,{messages:a.messages,conversationId:a.conversationId,userId:e.userId,userHash:e.userHash,contact:e.contact,actionResults:n,...d?{retry:!0}:{},...i&&i.length>0?{attachments:i}:{}},{onSources:L=>{H=L},onDelta:L=>{k.remove(),C?.remove(),C=null,v.content+=L,g.replaceChildren(ae(v.content)),G()},onError:L=>{k.remove(),C?.remove(),C=null,X(L),y("error",{message:L})},onFrame:L=>kt(L,Q,O,q)},a.controller?.signal,t).finally(()=>{k.remove(),M.setAttribute("aria-busy","false")}),Q.length>0&&!n){b.remove();let L=Q.find(we=>we.payload?.form);if(L){xe={name:L.name,input:L.input};let we=We(L.payload?.form,ze),fe=document.createElement("div");fe.className="msg",fe.dataset.role="assistant",fe.appendChild(we),M.appendChild(fe),G();return}let Tt=await Et(Q);await ue(Tt);return}if(v.content.trim()){let L=mt(H,v.content);v.sources=L.sources,v.citedAs=L.citedAs,a.messages.push(v),He(b,v.sources,v.citedAs),ht(b,a.messages.length-1,v.content,!0),it(e.endpoint,a.messages,e.persist!==!1),y("response",{text:v.content,sources:v.sources})}else b.remove();ce()}function xt(n){let i=n.split(`
`).filter(g=>g.trim()),d=i[i.length-1]??"";return d.length>120?`${d.slice(-120).trimStart()}`:d}function wt(n){return n.replace(/[_-]+/g," ").trim()}function kt(n,i,d=()=>{},g=()=>{}){if(n.type==="client-action")i.push({id:n.id,name:n.name,input:n.input,payload:n.payload});else if(n.type==="suggestions")a.suggestions=n.items,a.pickOne=n.pickOne===!0&&n.items.length>0;else if(n.type==="reasoning")g(n.text);else if(n.type==="action")y("action",{name:n.name,status:n.status,...n.input?{input:n.input}:{},...n.result===void 0?{}:{result:n.result}}),d(n.status==="running"?n.summary??wt(n.name):null);else if(n.type==="captured")y("captured",{kind:n.kind,name:n.name,values:n.values});else if(n.type==="notice")pe(n.message);else if(n.type==="handoff")y("handoff",{ticketId:n.ticketId,message:n.message}),pe(n.message);else if(n.type==="ui"){let b=_e({kind:n.kind,id:n.id,data:n.data},ze);if(b){let k=n.id?[...M.children].find(N=>N.dataset?.uiId===n.id):void 0,C=document.createElement("div");C.className="msg",C.dataset.role="assistant",n.id&&(C.dataset.uiId=n.id),C.appendChild(b),k?k.replaceWith(C):(M.appendChild(C),G())}}}let ze={submit:n=>{te(n)},respond:n=>{Ct(n)},run:async(n,i)=>{let d=u[n];if(!d)throw new Error("That is not available here");return d(i)}},xe=null;async function Ct(n){let i=xe;xe=null,!(!i||a.busy)&&(a.busy=!0,J(),a.controller=new AbortController,await ue([{name:i.name,input:i.input,output:n}]),a.busy=!1,J(),a.controller=null)}async function Et(n){return Promise.all(n.map(async i=>{let d=u[i.name];if(!d)return{name:i.name,input:i.input,output:{error:"no handler registered on this page"}};try{return{name:i.name,input:i.input,output:await d(i.input)}}catch(g){return{name:i.name,input:i.input,output:{error:g instanceof Error?g.message:String(g)}}}}))}function At(n,i){let d=document.createElement("div");d.className="attached";for(let g of i){if(g.mimeType.startsWith("image/")){let k=document.createElement("img");k.src=g.dataUrl,k.alt=g.name,d.appendChild(k);continue}let b=document.createElement("span");b.className="chip",b.textContent=g.name,d.appendChild(b)}n.appendChild(d)}function pe(n){let i=document.createElement("div");i.className="notice",i.textContent=n,M.appendChild(i),G()}function St(){if(r||!e.invite||m.dataset.open==="true")return;try{if(sessionStorage.getItem(ot(e.endpoint)))return}catch{}let n=document.createElement("div");n.className=`invite ${c}`,n.setAttribute("role","button"),n.tabIndex=0,n.appendChild(document.createTextNode(e.invite));let i=document.createElement("button");i.type="button",i.className="invite-dismiss",i.setAttribute("aria-label",t.dismiss),i.appendChild(D(B.close,!1));let d=()=>{n.remove();try{sessionStorage.setItem(ot(e.endpoint),"1")}catch{}};i.addEventListener("click",b=>{b.stopPropagation(),d()});let g=()=>{d(),K(!0)};n.addEventListener("click",g),n.addEventListener("keydown",b=>{(b.key==="Enter"||b.key===" ")&&(b.preventDefault(),g())}),n.appendChild(i),s.appendChild(n)}if(e.invite&&!r){let n=e.inviteDelay??4e3,i=setTimeout(St,n);h.push(i)}A.addEventListener("click",()=>K(m.dataset.open!=="true")),P.addEventListener("click",()=>K(!1)),$.addEventListener("click",()=>{typeof window.confirm=="function"&&!window.confirm(t.deleteConfirm)||Fe()}),ne.addEventListener("submit",n=>{n.preventDefault();let i=w.value;w.value="",w.style.height="auto",te(i)}),w.addEventListener("input",()=>{w.style.height="auto",w.style.height=`${w.scrollHeight}px`}),w.addEventListener("keydown",n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),ne.requestSubmit())}),s.addEventListener("keydown",n=>{n.key==="Escape"&&!r&&K(!1)}),De(),de();let me={open(n){let i=n?.ask?.trim();if(!i){K(!0);return}if(!n?.quietly){K(!0),te(i);return}let d=!1,g=[me.on("response",()=>{d||(d=!0,g.forEach(b=>b()),K(!0))}),me.on("error",()=>{d=!0,g.forEach(b=>b())})];te(i,{show:!1}).finally(()=>{d||(d=!0,g.forEach(b=>b()))})},close:()=>K(!1),ask:n=>te(n),setOptions(n){Object.assign(R,n),n.suggestions&&(R.suggestions=[...n.suggestions],a.messages.length===0&&(a.suggestions=[...n.suggestions])),Oe(n)},resetOptions(n){let i=Object.keys(Y).filter(d=>!n||n[d]);for(let d of i)d==="suggestions"?R.suggestions=[...Y.suggestions]:d==="greeting"?R.greeting=Array.isArray(Y.greeting)?[...Y.greeting]:Y.greeting:R[d]=Y[d];i.includes("suggestions")&&a.messages.length===0&&(a.suggestions=[...Y.suggestions]),Oe(Object.fromEntries(i.map(d=>[d,R[d]])))},on(n,i){let d=p.get(n)??new Set;return d.add(i),p.set(n,d),()=>d.delete(i)},handle(n,i){u[n]=i},clear(){Pe()},forget:()=>Fe(),destroy(){a.controller?.abort();for(let n of h)clearTimeout(n);o.remove()},element:o};return e.deepLink!==!1&&rt(me),me}function ln(e,t){if(t!=="auto"){e.setAttribute("data-theme",t);return}let r=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>e.setAttribute("data-theme",r.matches?"dark":"light");o(),r.addEventListener("change",o)}function cn(e){let t=Math.max(0,Math.floor((Date.now()-e)/1e3));return`${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`}function D(e,t){let r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("viewBox","0 0 24 24"),r.setAttribute("aria-hidden","true"),r.setAttribute("fill",t?"currentColor":"none"),r.setAttribute("stroke",t?"none":"currentColor"),r.setAttribute("stroke-width","2"),r.setAttribute("stroke-linecap","round");let o=document.createElementNS("http://www.w3.org/2000/svg","path");return o.setAttribute("d",e),r.appendChild(o),r}function dn(e){try{let t=sessionStorage.getItem(at(e));if(!t)return[];let r=JSON.parse(t);return Array.isArray(r)?r.filter(o=>{if(typeof o!="object"||o===null)return!1;let s=o;return(s.role==="user"||s.role==="assistant")&&typeof s.content=="string"}):[]}catch{return[]}}function it(e,t,r){if(r)try{sessionStorage.setItem(at(e),JSON.stringify(t.slice(-20)))}catch{}}function un(e){return new Promise((t,r)=>{let o=new FileReader;o.onload=()=>t(String(o.result)),o.onerror=()=>r(new Error("unreadable")),o.readAsDataURL(e)})}function pn(){let t=document.currentScript?.dataset??{},r=t.endpoint??window.recourseConfig?.endpoint;if(!r)return console.warn("[recourse] no data-endpoint on the script tag, widget not mounted"),null;let o=t.target?document.querySelector(t.target):null;return{endpoint:r,userId:t.userId,userHash:t.userHash,feedback:t.feedback!=="false",invite:t.invite,inviteDelay:t.inviteDelay?Number(t.inviteDelay):void 0,title:t.title,subtitle:t.subtitle,...t.footnote?{strings:{footnote:t.footnote}}:{},greeting:t.greeting?.includes("|")?t.greeting.split("|").map(s=>s.trim()).filter(Boolean):t.greeting,greetingArt:t.greetingArt,accent:t.accent,suggestions:t.suggestions?.split("|").map(s=>s.trim()).filter(Boolean),position:t.position==="bottom-left"?"bottom-left":"bottom-right",theme:t.theme==="dark"||t.theme==="light"?t.theme:"auto",open:t.open==="true",persist:t.persist!=="false",deepLink:t.deepLink!=="false",...mn(t.attachments),...t.dictation==="true"?{dictation:{...t.dictationLang?{lang:t.dictationLang}:{},...t.dictationCloud==="true"?{allowCloudFallback:!0}:{}}}:{},...t.call?{call:t.callTransport==="hosted"?{endpoint:t.call,transport:"hosted"}:t.call}:{},copy:t.copy!=="false",retry:t.retry!=="false",allowDelete:t.delete==="true",...window.recourseConfig,...o?{target:o}:{}}}function mn(e){if(!e||e==="false")return{};if(e==="true")return{attachments:!0};let t=Number(e);return Number.isFinite(t)&&t>0?{attachments:{maxBytes:Math.round(t*1024*1024)}}:{}}var lt=pn();if(lt){let e=()=>{window.recourse=st(lt)};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e,{once:!0}):e()}})();
