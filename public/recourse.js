"use strict";
(() => {
  // src/render.ts
  var INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;
  var SAFE_URL = /^(https?:|mailto:|\/|#)/i;
  function renderMarkdown(text2) {
    const fragment = document.createDocumentFragment();
    for (const block of splitBlocks(text2)) {
      fragment.appendChild(renderBlock(block));
    }
    return fragment;
  }
  function splitBlocks(text2) {
    const blocks = [];
    let current = null;
    let fence = null;
    const flush = () => {
      if (current && current.lines.length > 0) blocks.push(current);
      current = null;
    };
    for (const line of text2.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) {
        if (fence) {
          blocks.push(fence);
          fence = null;
        } else {
          flush();
          fence = { kind: "code", lines: [] };
        }
        continue;
      }
      if (fence) {
        fence.lines.push(line);
        continue;
      }
      if (line.trim() === "") {
        flush();
        continue;
      }
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      const kind = bullet ? "ul" : numbered ? "ol" : "p";
      const content = bullet?.[1] ?? numbered?.[1] ?? line;
      if (!current || current.kind !== kind) {
        flush();
        current = { kind, lines: [] };
      }
      current.lines.push(content);
    }
    if (fence) blocks.push(fence);
    flush();
    return blocks;
  }
  function renderBlock(block) {
    if (block.kind === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.lines.join("\n");
      pre.appendChild(code);
      return pre;
    }
    if (block.kind === "ul" || block.kind === "ol") {
      const list2 = document.createElement(block.kind);
      for (const line of block.lines) {
        const item = document.createElement("li");
        item.appendChild(renderInline(line));
        list2.appendChild(item);
      }
      return list2;
    }
    const paragraph = document.createElement("p");
    paragraph.appendChild(renderInline(block.lines.join(" ")));
    return paragraph;
  }
  function renderInline(text2) {
    const fragment = document.createDocumentFragment();
    for (const part of text2.split(INLINE)) {
      if (!part) continue;
      if (part.startsWith("**") && part.endsWith("**")) {
        fragment.appendChild(element("strong", part.slice(2, -2)));
        continue;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        fragment.appendChild(element("code", part.slice(1, -1)));
        continue;
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        fragment.appendChild(element("em", part.slice(1, -1)));
        continue;
      }
      const link2 = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
      if (link2) {
        const href = link2[2];
        if (SAFE_URL.test(href)) {
          const anchor = document.createElement("a");
          anchor.textContent = link2[1];
          anchor.href = href;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          fragment.appendChild(anchor);
        } else {
          fragment.appendChild(document.createTextNode(link2[1]));
        }
        continue;
      }
      fragment.appendChild(document.createTextNode(part));
    }
    return fragment;
  }
  function element(tag, text2) {
    const node = document.createElement(tag);
    node.textContent = text2;
    return node;
  }

  // src/ui.ts
  var SAFE_URL2 = /^(https?:|mailto:|tel:|\/|#)/i;
  function visible(item, data) {
    const condition = item.showIf;
    if (condition === void 0) return true;
    if (typeof condition === "boolean") return condition;
    if (typeof condition === "string") {
      const negated = condition.startsWith("!");
      const body = negated ? condition.slice(1) : condition;
      const [key, expected] = body.split("=", 2);
      const value = data[(key ?? "").trim()];
      const result = expected === void 0 ? Boolean(value) : String(value) === expected.trim();
      return negated ? !result : result;
    }
    return true;
  }
  function text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function str(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }
  function link(label, url, className) {
    if (!SAFE_URL2.test(url)) return text("span", label, className);
    const anchor = document.createElement("a");
    anchor.textContent = label;
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.className = className;
    return anchor;
  }
  var button = (data) => {
    const label = str(data.label) || "Open";
    const url = str(data.url);
    if (!url) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "ui-actions";
    wrapper.appendChild(link(label, url, "ui-button"));
    return wrapper;
  };
  function actionButton(action, context) {
    const label = str(action.label);
    if (!label) return null;
    if (action.url) return link(label, str(action.url), "ui-button");
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.className = "ui-button";
    button2.textContent = label;
    if (action.run) {
      button2.addEventListener("click", async () => {
        if (!context.run) return;
        button2.disabled = true;
        try {
          await context.run(str(action.run), action.payload ?? {});
          button2.replaceWith(text("span", str(action.done) || "Done", "ui-muted"));
        } catch (error) {
          button2.disabled = false;
          button2.textContent = error instanceof Error ? error.message : "That did not work";
        }
      });
      return button2;
    }
    button2.addEventListener("click", () => context.submit(str(action.send) || label));
    return button2;
  }
  var card = (data, context) => {
    const root = document.createElement("div");
    root.className = "ui-card";
    if (data.image && SAFE_URL2.test(str(data.image))) {
      const image = document.createElement("img");
      image.src = str(data.image);
      image.alt = str(data.title);
      image.loading = "lazy";
      image.className = "ui-card-image";
      root.appendChild(image);
    }
    const body = document.createElement("div");
    body.className = "ui-card-body";
    if (data.title) body.appendChild(text("h3", str(data.title)));
    if (data.subtitle) body.appendChild(text("p", str(data.subtitle), "ui-muted"));
    const fields = (Array.isArray(data.fields) ? data.fields : []).filter(
      (field) => visible(field, data)
    );
    if (fields.length > 0) {
      const list2 = document.createElement("dl");
      list2.className = "ui-fields";
      for (const raw of fields) {
        const field = raw;
        list2.appendChild(text("dt", str(field.label)));
        list2.appendChild(text("dd", str(field.value)));
      }
      body.appendChild(list2);
    }
    const actions = (Array.isArray(data.actions) ? data.actions : []).filter(
      (action) => visible(action, data)
    );
    if (actions.length > 0) {
      const row = document.createElement("div");
      row.className = "ui-actions";
      for (const raw of actions) {
        const node = actionButton(raw, context);
        if (node) row.appendChild(node);
      }
      if (row.childElementCount > 0) body.appendChild(row);
    }
    root.appendChild(body);
    return root;
  };
  var table = (data) => {
    const columns = (Array.isArray(data.columns) ? data.columns : []).map(str);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (columns.length === 0 || rows.length === 0) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "ui-table-wrap";
    const element2 = document.createElement("table");
    element2.className = "ui-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of columns) headRow.appendChild(text("th", column));
    head.appendChild(headRow);
    element2.appendChild(head);
    const body = document.createElement("tbody");
    for (const raw of rows.slice(0, 25)) {
      const row = document.createElement("tr");
      const cells = Array.isArray(raw) ? raw : columns.map((column) => raw[column]);
      for (const cell of cells) row.appendChild(text("td", str(cell)));
      body.appendChild(row);
    }
    element2.appendChild(body);
    wrapper.appendChild(element2);
    return wrapper;
  };
  var list = (data, context) => {
    const items = (Array.isArray(data.items) ? data.items : []).filter(
      (item) => visible(item, data)
    );
    if (items.length === 0) return null;
    const root = document.createElement("div");
    root.className = "ui-list";
    for (const raw of items) {
      const item = raw;
      const title = str(item.title);
      if (!title) continue;
      const entry = document.createElement(item.url ? "a" : "button");
      entry.className = "ui-list-item";
      if (entry instanceof HTMLAnchorElement && SAFE_URL2.test(str(item.url))) {
        entry.href = str(item.url);
        entry.target = "_blank";
        entry.rel = "noopener noreferrer";
      } else if (entry instanceof HTMLButtonElement) {
        entry.type = "button";
        entry.addEventListener("click", () => context.submit(str(item.send) || title));
      }
      entry.appendChild(text("span", title, "ui-list-title"));
      if (item.subtitle) entry.appendChild(text("span", str(item.subtitle), "ui-muted"));
      root.appendChild(entry);
    }
    return root.childElementCount > 0 ? root : null;
  };
  function renderForm(definition, context) {
    const form = document.createElement("form");
    form.className = "ui-form";
    if (definition.title) form.appendChild(text("h3", definition.title));
    const fields = Array.isArray(definition.fields) ? definition.fields : [];
    const inputs = [];
    for (const raw of fields) {
      const field = raw;
      const name = str(field.name);
      if (!name) continue;
      const label = document.createElement("label");
      label.className = "ui-field";
      label.appendChild(text("span", str(field.label) || name));
      let element2;
      if (Array.isArray(field.options) && field.options.length > 0) {
        const select = document.createElement("select");
        for (const option of field.options) {
          const node = document.createElement("option");
          node.value = str(option);
          node.textContent = str(option);
          select.appendChild(node);
        }
        element2 = select;
      } else if (field.type === "boolean") {
        const input = document.createElement("input");
        input.type = "checkbox";
        element2 = input;
      } else {
        const input = document.createElement("input");
        input.type = field.type === "number" ? "number" : "text";
        if (field.placeholder) input.placeholder = str(field.placeholder);
        element2 = input;
      }
      element2.name = name;
      if (field.required !== false && element2 instanceof HTMLInputElement && element2.type !== "checkbox") {
        element2.required = true;
      }
      label.appendChild(element2);
      form.appendChild(label);
      inputs.push({ name, element: element2 });
    }
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "ui-button";
    submit.textContent = definition.submitLabel || "Send";
    form.appendChild(submit);
    let submitted = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submitted) return;
      submitted = true;
      const values = {};
      for (const { name, element: element2 } of inputs) {
        values[name] = element2 instanceof HTMLInputElement && element2.type === "checkbox" ? element2.checked : element2.value;
      }
      form.replaceChildren(renderMarkdown("Thanks, sending that now."));
      context.respond(values);
    });
    return form;
  }
  var RENDERERS = { button, card, table, list };
  function renderUi(frame, context) {
    const renderer = RENDERERS[frame.kind];
    return renderer ? renderer(frame.data, context) : null;
  }

  // src/stream.ts
  var DEFAULT_TRANSPORT_STRINGS = {
    offline: "Could not reach the assistant. Check your connection.",
    rateLimited: "Too many messages just now. Give it a moment.",
    unavailable: "The assistant is unavailable ({status})."
  };
  async function streamChat(endpoint, request, handlers, signal, strings = DEFAULT_TRANSPORT_STRINGS) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...request,
          // History travels as text. The files ride at the top level and belong
          // to the message being asked now, so an image is uploaded once rather
          // than on every turn that follows it.
          messages: request.messages.map((message) => ({ role: message.role, content: message.content }))
        }),
        signal
      });
    } catch {
      handlers.onError?.(strings.offline);
      return;
    }
    if (!response.ok || !response.body) {
      handlers.onError?.(
        response.status === 429 ? strings.rateLimited : strings.unavailable.replace("{status}", String(response.status))
      );
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((part) => part.startsWith("data:"));
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        handlers.onFrame?.(parsed);
        if (parsed.type === "sources") handlers.onSources?.(parsed.sources);
        else if (parsed.type === "delta") handlers.onDelta?.(parsed.text);
        else if (parsed.type === "done") handlers.onDone?.();
        else if (parsed.type === "error") handlers.onError?.(parsed.message);
      }
    }
    handlers.onDone?.();
  }

  // src/dictation.ts
  function speechRecognition(scope = globalThis) {
    const global = scope;
    return global.SpeechRecognition ?? global.webkitSpeechRecognition ?? null;
  }
  var MESSAGES = {
    "not-allowed": "I need permission to use the microphone. You can allow it in your browser settings.",
    "service-not-allowed": "Your browser would not let me use speech recognition.",
    "no-speech": "I did not hear anything. Try again?",
    "audio-capture": "I could not find a microphone.",
    network: "Speech recognition needs a connection and could not reach it.",
    "language-not-supported": "Speech recognition is not available for this language on your device."
  };
  function createDictation(options = {}, scope = globalThis) {
    const found = speechRecognition(scope);
    if (!found) return null;
    const Recognition = found;
    let active = null;
    let retriedWithoutLocal = false;
    function build(processLocally) {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      const lang = options.lang ?? documentLang(scope);
      if (lang) recognition.lang = lang;
      if (processLocally) recognition.processLocally = true;
      return recognition;
    }
    function attach(recognition) {
      recognition.onstart = () => options.onStateChange?.(true);
      recognition.onresult = (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (!result) continue;
          const text2 = result[0]?.transcript ?? "";
          if (result.isFinal) options.onFinal?.(text2);
          else interim += text2;
        }
        if (interim) options.onInterim?.(interim);
      };
      recognition.onerror = (event) => {
        const local = options.processLocally !== false;
        const recoverable = event.error === "language-not-supported" || event.error === "service-not-allowed";
        if (local && recoverable && options.allowCloudFallback && !retriedWithoutLocal) {
          retriedWithoutLocal = true;
          active = null;
          startWith(false);
          return;
        }
        if (event.error !== "aborted") {
          options.onError?.(MESSAGES[event.error] ?? "Speech recognition stopped unexpectedly.");
        }
      };
      recognition.onend = () => {
        active = null;
        options.onStateChange?.(false);
      };
    }
    function startWith(processLocally) {
      const recognition = build(processLocally);
      attach(recognition);
      active = recognition;
      try {
        recognition.start();
      } catch {
        active = null;
        options.onStateChange?.(false);
      }
    }
    return {
      get recording() {
        return active !== null;
      },
      start() {
        if (active) return;
        retriedWithoutLocal = false;
        startWith(options.processLocally !== false);
      },
      stop() {
        active?.stop();
      },
      cancel() {
        const recognition = active;
        active = null;
        recognition?.abort();
        options.onStateChange?.(false);
      },
      toggle() {
        if (active) this.stop();
        else this.start();
      }
    };
  }
  function documentLang(scope) {
    const documentRef = scope.document;
    return documentRef?.documentElement?.lang ?? "";
  }

  // src/call.ts
  function createCall(options) {
    const request = options.fetch ?? globalThis.fetch.bind(globalThis);
    const load = options.load ?? loadRuntime;
    let state = "idle";
    let session = null;
    let attempt = 0;
    const move = (next) => {
      if (state === next) return;
      state = next;
      options.onStateChange?.(next);
    };
    const fail = (message) => {
      move("failed");
      options.onError?.(message);
    };
    async function start() {
      if (state === "connecting" || state === "live") return;
      const mine = ++attempt;
      move("connecting");
      let signedUrl;
      try {
        const response = await request(options.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId: options.conversationId() })
        });
        if (response.status === 429) {
          if (mine === attempt) fail("Too many calls just now. Try again in a moment.");
          return;
        }
        if (!response.ok) {
          if (mine === attempt) fail("Calling is not available right now.");
          return;
        }
        const body = await response.json();
        if (typeof body.signedUrl !== "string" || !body.signedUrl) {
          if (mine === attempt) fail("Calling is not available right now.");
          return;
        }
        signedUrl = body.signedUrl;
      } catch {
        if (mine === attempt) fail("Could not reach the server to start the call.");
        return;
      }
      if (mine !== attempt) return;
      let runtime;
      try {
        runtime = await load();
      } catch {
        if (mine === attempt) fail("Could not load the voice connection.");
        return;
      }
      if (mine !== attempt) return;
      try {
        const started = await runtime.startSession({
          signedUrl,
          onConnect: () => {
            if (mine === attempt) move("live");
          },
          onDisconnect: () => {
            if (mine === attempt) {
              session = null;
              move("ended");
            }
          },
          // The microphone prompt lives inside the runtime, so a refusal arrives
          // here rather than as a thrown error, and it is the most likely thing
          // to go wrong on a first call.
          onError: () => {
            if (mine === attempt) fail("The call ended unexpectedly. Your microphone may be blocked.");
          },
          onMessage: (message) => {
            const text2 = typeof message?.message === "string" ? message.message.trim() : "";
            if (!text2) return;
            options.onTranscript?.({ role: message.source === "user" ? "visitor" : "agent", text: text2 });
          }
        });
        if (mine !== attempt) {
          await Promise.resolve(started.endSession()).catch(() => {
          });
          return;
        }
        session = started;
      } catch {
        if (mine === attempt) fail("Could not start the call. Your microphone may be blocked.");
      }
    }
    async function stop() {
      attempt++;
      const open = session;
      session = null;
      if (open) {
        try {
          await open.endSession();
        } catch {
        }
      }
      move(state === "failed" ? "failed" : "ended");
    }
    return {
      get state() {
        return state;
      },
      start,
      stop,
      async toggle() {
        if (state === "connecting" || state === "live") await stop();
        else await start();
      }
    };
  }
  var RUNTIME_URL = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.23.0/+esm";
  async function loadRuntime() {
    const source = RUNTIME_URL;
    const module = await import(
      /* @vite-ignore */
      source
    );
    if (!module.Conversation) throw new Error("no conversation runtime in the loaded module");
    return module.Conversation;
  }

  // src/styles.ts
  var styles = `
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
`;

  // src/strings.ts
  var DEFAULT_STRINGS = {
    title: "Ask us anything",
    open: "Open the support chat",
    close: "Close the support chat",
    placeholder: "Type your question",
    send: "Send",
    inputLabel: "Your question",
    attach: "Attach a file",
    removeFile: "Remove {name}",
    dictate: "Dictate your question",
    stopDictating: "Stop dictating",
    call: "Talk to us",
    endCall: "End the call",
    calling: "Connecting",
    callStarted: "Call started",
    callEnded: "Call ended",
    helpful: "This helped",
    notHelpful: "This did not help",
    thanks: "Thanks, that helps us improve.",
    copy: "Copy this answer",
    copied: "Copied",
    deleteConversation: "Delete this conversation",
    deleteConfirm: "Delete this conversation? It cannot be brought back.",
    offline: "Could not reach the assistant. Check your connection.",
    rateLimited: "Too many messages just now. Give it a moment.",
    unavailable: "The assistant is unavailable ({status}).",
    submit: "Send",
    submitted: "Thanks, sending that now.",
    dismiss: "Dismiss"
  };
  function resolveStrings(overrides) {
    if (!overrides) return DEFAULT_STRINGS;
    const resolved = { ...DEFAULT_STRINGS };
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === "string" && value.trim().length > 0) {
        resolved[key] = value;
      }
    }
    return resolved;
  }
  function fill(template, values) {
    return template.replace(
      /\{(\w+)\}/g,
      (whole, key) => key in values ? String(values[key]) : whole
    );
  }

  // src/deeplink.ts
  var DEEP_LINK_PARAMS = ["recourse_q", "rc_q"];
  var MAX_LENGTH = 1e3;
  function readDeepLink(options = {}) {
    const names = options.params ?? DEEP_LINK_PARAMS;
    let url;
    try {
      url = new URL(options.href ?? window.location.href);
    } catch {
      return null;
    }
    let question = null;
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value && value.trim()) {
        question = value.trim().slice(0, MAX_LENGTH);
        break;
      }
    }
    if (question === null) return null;
    if (options.strip !== false) {
      for (const name of names) url.searchParams.delete(name);
      try {
        window.history.replaceState(window.history.state, "", url.toString());
      } catch {
      }
    }
    return question;
  }
  function openDeepLink(widget, options = {}) {
    const question = readDeepLink(options);
    if (question === null) return null;
    widget.open();
    void widget.ask(question);
    return question;
  }

  // src/widget.ts
  function storageKey(endpoint) {
    return `recourse:transcript:${endpoint}`;
  }
  function inviteKey(endpoint) {
    return `recourse:invite:${endpoint}`;
  }
  var ICONS = {
    chat: "M12 3c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20l1-3.3C4.2 15.3 3 13.1 3 10.6 3 6.4 7 3 12 3z",
    close: "M6 6l12 12M18 6L6 18",
    send: "M4 12l16-8-6 8 6 8z",
    clip: "M21 11.5l-8.6 8.6a5 5 0 01-7-7l8.5-8.6a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.9-7.8",
    mic: "M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3",
    phone: "M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.57 3.6 1 1 0 01-.25 1z",
    hangUp: "M3 10.5c5-4 13-4 18 0v3.2a1 1 0 01-1.3.95l-3.4-1a1 1 0 01-.7-1V10a12 12 0 00-7.2 0v2.6a1 1 0 01-.7 1l-3.4 1A1 1 0 013 13.7z"
  };
  var ACCEPTED_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];
  function createWidget(options) {
    if (!options.endpoint) throw new Error("recourse: an `endpoint` is required");
    const strings = resolveStrings(options.strings);
    const inline = Boolean(options.target);
    const host = document.createElement("div");
    host.setAttribute("data-recourse", "");
    if (inline) host.setAttribute("data-inline", "true");
    host.style.cssText = inline ? "display:block;width:100%;height:100%" : "";
    const root = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = styles;
    root.appendChild(sheet);
    if (options.accent) host.style.setProperty("--rc-accent", options.accent);
    applyTheme(host, options.theme ?? "auto");
    const side = options.position === "bottom-left" ? "pos-left" : "pos-right";
    const state = {
      messages: options.persist === false ? [] : restore(options.endpoint),
      busy: false,
      controller: null,
      // Groups this tab's turns into one thread in the transcript log.
      conversationId: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      suggestions: options.suggestions ?? [],
      staged: []
    };
    const handlers = { ...options.actions };
    const invites = [];
    const listeners = /* @__PURE__ */ new Map();
    function emit(name, payload) {
      for (const listener of listeners.get(name) ?? []) {
        try {
          ;
          listener(payload);
        } catch (error) {
          console.error(`[recourse] listener for "${name}" threw`, error);
        }
      }
    }
    const launcher = document.createElement("button");
    launcher.className = `launcher ${side}`;
    launcher.type = "button";
    launcher.setAttribute("aria-label", strings.open);
    launcher.setAttribute("aria-expanded", "false");
    launcher.appendChild(icon(ICONS.chat, true));
    const panel = document.createElement("div");
    panel.className = `panel ${side}`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", options.title ?? strings.title);
    panel.dataset.open = String(inline || options.open === true);
    const header = document.createElement("div");
    header.className = "header";
    const heading = document.createElement("div");
    heading.className = "grow";
    const title = document.createElement("h2");
    title.textContent = options.title ?? strings.title;
    heading.appendChild(title);
    if (options.subtitle) {
      const subtitle = document.createElement("p");
      subtitle.textContent = options.subtitle;
      heading.appendChild(subtitle);
    }
    header.appendChild(heading);
    const forget = document.createElement("button");
    forget.className = "icon-button";
    forget.type = "button";
    forget.setAttribute("aria-label", strings.deleteConversation);
    forget.appendChild(
      icon("M3 6h18v2H3V6zm2 3h14l-1 12H6L5 9zm5 2v8h2v-8h-2zm4 0v8h2v-8h-2zM9 3h6v2H9V3z", false)
    );
    if (options.allowDelete) header.appendChild(forget);
    const close = document.createElement("button");
    close.className = "icon-button";
    close.type = "button";
    close.setAttribute("aria-label", strings.close);
    close.appendChild(icon(ICONS.close, false));
    if (!inline) header.appendChild(close);
    const log = document.createElement("div");
    log.className = "log";
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-relevant", "additions text");
    log.setAttribute("aria-live", "polite");
    log.setAttribute("aria-relevant", "additions text");
    const suggestions = document.createElement("div");
    suggestions.className = "suggestions";
    const errorBox = document.createElement("div");
    errorBox.className = "error";
    errorBox.hidden = true;
    errorBox.setAttribute("role", "alert");
    const composer = document.createElement("form");
    composer.className = "composer";
    const input = document.createElement("textarea");
    input.setAttribute("dir", "auto");
    input.rows = 1;
    input.placeholder = strings.placeholder;
    input.setAttribute("aria-label", strings.inputLabel);
    const send = document.createElement("button");
    send.type = "submit";
    send.setAttribute("aria-label", strings.send);
    send.appendChild(icon(ICONS.send, true));
    const uploads = options.attachments ? {
      maxBytes: (typeof options.attachments === "object" ? options.attachments.maxBytes : void 0) ?? 10 * 1024 * 1024,
      maxCount: (typeof options.attachments === "object" ? options.attachments.maxCount : void 0) ?? 4,
      accept: (typeof options.attachments === "object" ? options.attachments.accept : void 0) ?? ACCEPTED_TYPES
    } : null;
    const tray = document.createElement("div");
    tray.className = "tray";
    tray.hidden = true;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    picker.tabIndex = -1;
    const attach = document.createElement("button");
    attach.type = "button";
    attach.className = "attach";
    attach.setAttribute("aria-label", strings.attach);
    attach.appendChild(icon(ICONS.clip, false));
    const dictationSettings = options.dictation ? typeof options.dictation === "object" ? options.dictation : {} : null;
    const mic = document.createElement("button");
    mic.type = "button";
    mic.className = "mic";
    mic.setAttribute("aria-label", strings.dictate);
    mic.appendChild(icon(ICONS.mic, false));
    let dictation = null;
    if (uploads) picker.accept = uploads.accept.join(",");
    if (dictationSettings) {
      dictation = createDictation({
        ...dictationSettings,
        onStateChange: (recording) => {
          mic.dataset.recording = String(recording);
          mic.setAttribute("aria-label", recording ? strings.stopDictating : strings.dictate);
          if (!recording) input.dataset.interim = "";
        },
        onInterim: (text2) => {
          input.value = `${input.dataset.beforeDictation ?? ""}${text2}`;
        },
        onFinal: (text2) => {
          const before = input.dataset.beforeDictation ?? "";
          const joined = before && !before.endsWith(" ") ? `${before} ${text2}` : `${before}${text2}`;
          input.value = joined;
          input.dataset.beforeDictation = joined;
        },
        onError: (message) => showError(message)
      });
      if (dictation) {
        mic.addEventListener("click", () => {
          if (!dictation) return;
          if (!dictation.recording) input.dataset.beforeDictation = input.value;
          dictation.toggle();
          input.focus();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Escape" && dictation?.recording) {
            event.preventDefault();
            input.value = input.dataset.beforeDictation ?? "";
            dictation.cancel();
          }
        });
      }
    }
    const callEndpoint = typeof options.call === "string" ? options.call : options.call ? options.call.endpoint : null;
    const callRuntime = typeof options.call === "object" ? options.call.load : void 0;
    const callButton = document.createElement("button");
    callButton.type = "button";
    callButton.className = "call";
    callButton.setAttribute("aria-label", strings.call);
    callButton.appendChild(icon(ICONS.phone, false));
    let call = null;
    if (callEndpoint) {
      call = createCall({
        endpoint: callEndpoint,
        ...callRuntime ? { load: callRuntime } : {},
        // Read per dial rather than captured, so a call placed after the thread
        // was cleared belongs to the conversation now on screen.
        conversationId: () => state.conversationId,
        onStateChange: (next) => paintCallState(next),
        // Same thread as everything else: a spoken answer and a typed one are
        // the same conversation, and splitting them makes the visitor read two.
        onTranscript: ({ role, text: text2 }) => void paintMessage({ role: role === "visitor" ? "user" : "assistant", content: text2 }),
        onError: (message) => showError(message)
      });
      callButton.addEventListener("click", () => void call?.toggle());
    }
    function paintCallState(next) {
      callButton.dataset.state = next;
      const live = next === "live" || next === "connecting";
      callButton.setAttribute("aria-label", live ? strings.endCall : strings.call);
      callButton.replaceChildren(icon(live ? ICONS.hangUp : ICONS.phone, false));
      if (next === "live") paintNotice(strings.callStarted);
      if (next === "ended") paintNotice(strings.callEnded);
    }
    const micButton = dictation ? [mic] : [];
    const dialButton = call ? [callButton] : [];
    composer.append(...uploads ? [attach] : [], input, ...micButton, ...dialButton, send);
    panel.append(header, log, suggestions, errorBox, tray, composer);
    if (uploads) panel.appendChild(picker);
    if (!inline) root.append(launcher, panel);
    else root.append(panel);
    (options.target ?? document.body).appendChild(host);
    if (uploads) {
      attach.addEventListener("click", () => picker.click());
      picker.addEventListener("change", () => {
        if (picker.files) void stage(picker.files);
        picker.value = "";
      });
      panel.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        panel.dataset.dropping = "true";
      });
      panel.addEventListener("dragleave", () => {
        delete panel.dataset.dropping;
      });
      panel.addEventListener("drop", (event) => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        delete panel.dataset.dropping;
        void stage(event.dataTransfer.files);
      });
      input.addEventListener("paste", (event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return;
        event.preventDefault();
        void stage(files);
      });
    }
    function setOpen(open) {
      emit(open ? "open" : "close", {});
      if (open) root.querySelector(".invite")?.remove();
      panel.dataset.open = String(open);
      launcher.setAttribute("aria-expanded", String(open));
      launcher.setAttribute("aria-label", open ? strings.close : strings.open);
      if (open) input.focus();
      else launcher.focus();
    }
    function showError(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }
    async function stage(files) {
      if (!uploads) return;
      errorBox.hidden = true;
      for (const file of Array.from(files)) {
        if (state.staged.length >= uploads.maxCount) {
          showError(`You can attach ${uploads.maxCount} files at a time.`);
          break;
        }
        const mimeType = (file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (!uploads.accept.includes(mimeType)) {
          showError(`${file.name} is not a file type we can read.`);
          continue;
        }
        if (file.size > uploads.maxBytes) {
          showError(`${file.name} is larger than ${Math.round(uploads.maxBytes / 1024 / 1024)}MB.`);
          continue;
        }
        let dataUrl;
        try {
          dataUrl = await readAsDataUrl(file);
        } catch {
          showError(`${file.name} could not be read.`);
          continue;
        }
        state.staged.push({ name: file.name, mimeType, dataUrl, bytes: file.size });
      }
      paintTray();
    }
    function paintTray() {
      tray.replaceChildren();
      tray.hidden = state.staged.length === 0;
      for (const [position, file] of state.staged.entries()) {
        const chip = document.createElement("span");
        chip.className = "chip";
        const label = document.createElement("span");
        label.textContent = file.name;
        chip.appendChild(label);
        const drop = document.createElement("button");
        drop.type = "button";
        drop.setAttribute("aria-label", fill(strings.removeFile, { name: file.name }));
        drop.appendChild(icon(ICONS.close, false));
        drop.addEventListener("click", () => {
          state.staged.splice(position, 1);
          paintTray();
          input.focus();
        });
        chip.appendChild(drop);
        tray.appendChild(chip);
      }
    }
    function scrollToEnd() {
      log.scrollTop = log.scrollHeight;
    }
    function citedOnly(refs, answer) {
      const used = /* @__PURE__ */ new Set();
      for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
        used.add(Number.parseInt(match[1], 10) - 1);
      }
      const cited = used.size > 0 ? refs.filter((_, position) => used.has(position)) : refs;
      const seen = /* @__PURE__ */ new Set();
      const unique = [];
      for (const ref of cited) {
        const key = `${ref.url ?? ""}|${ref.title}|${ref.section ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(ref);
      }
      return unique;
    }
    function paintSources(container, refs) {
      if (refs.length === 0) return;
      const list2 = document.createElement("div");
      list2.className = "sources";
      for (const ref of refs.slice(0, 4)) {
        const label = ref.section ? `${ref.title} \xB7 ${ref.section}` : ref.title;
        const node = document.createElement(ref.url ? "a" : "span");
        node.textContent = label;
        if (ref.url && node instanceof HTMLAnchorElement) {
          node.href = ref.url;
          node.target = "_blank";
          node.rel = "noopener noreferrer";
        }
        list2.appendChild(node);
      }
      container.appendChild(list2);
    }
    function paintMessage(message) {
      const wrapper = document.createElement("div");
      wrapper.className = "msg";
      wrapper.dataset.role = message.role;
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.setAttribute("dir", "auto");
      if (message.role === "user") bubble.textContent = message.content;
      else bubble.appendChild(renderMarkdown(message.content));
      if (message.role === "user" && !message.content && message.attachments?.length) bubble.remove();
      else wrapper.appendChild(bubble);
      if (message.attachments?.length) paintAttached(wrapper, message.attachments);
      if (message.sources) paintSources(wrapper, message.sources);
      log.appendChild(wrapper);
      scrollToEnd();
      return { bubble, wrapper };
    }
    function paintSuggestions() {
      suggestions.replaceChildren();
      if (state.suggestions.length === 0) return;
      for (const text2 of state.suggestions.slice(0, 4)) {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.textContent = text2;
        button2.addEventListener("click", () => void ask(text2));
        suggestions.appendChild(button2);
      }
    }
    function repaint() {
      log.replaceChildren();
      if (options.greeting) {
        paintMessage({ role: "assistant", content: options.greeting });
      }
      for (const message of state.messages) paintMessage(message);
      paintSuggestions();
    }
    function paintCopy(text2) {
      if (options.copy === false) return;
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
      const button2 = document.createElement("button");
      button2.type = "button";
      button2.className = "icon-button";
      button2.setAttribute("aria-label", strings.copy);
      button2.appendChild(
        icon("M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z", true)
      );
      button2.addEventListener("click", () => {
        void navigator.clipboard.writeText(text2).then(() => {
          button2.setAttribute("aria-label", strings.copied);
          button2.setAttribute("data-copied", "true");
          setTimeout(() => {
            button2.setAttribute("aria-label", strings.copy);
            button2.removeAttribute("data-copied");
          }, 1600);
        }).catch(() => {
        });
      });
      return button2;
    }
    function forgetLocally() {
      state.messages = [];
      state.suggestions = options.suggestions ?? [];
      state.conversationId = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      persist(options.endpoint, [], options.persist !== false);
      repaint();
    }
    async function forgetConversation() {
      const conversationId = state.conversationId;
      forgetLocally();
      try {
        await fetch(options.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleteConversation: conversationId })
        });
      } catch {
      }
    }
    function paintFeedback(wrapper, messageIndex, text2 = "") {
      const copyButton = paintCopy(text2);
      if (options.feedback === false) {
        if (!copyButton) return;
        const only = document.createElement("div");
        only.className = "feedback";
        only.appendChild(copyButton);
        wrapper.appendChild(only);
        return;
      }
      const row = document.createElement("div");
      row.className = "feedback";
      for (const [value, label, glyph] of [
        ["positive", strings.helpful, "M7 11v9H3v-9h4zm3 9V11l4-8a2 2 0 013 2l-1 5h5a2 2 0 012 2l-2 7a2 2 0 01-2 2h-9z"],
        ["negative", strings.notHelpful, "M17 13V4h4v9h-4zm-3-9v9l-4 8a2 2 0 01-3-2l1-5H3a2 2 0 01-2-2l2-7a2 2 0 012-2h9z"]
      ]) {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.className = "icon-button";
        button2.setAttribute("aria-label", label);
        button2.appendChild(icon(glyph, true));
        button2.addEventListener("click", () => {
          button2.setAttribute("aria-pressed", "true");
          row.querySelectorAll("button").forEach((other) => {
            if (other !== button2) other.removeAttribute("aria-pressed");
          });
          void sendFeedback(messageIndex, value);
        });
        row.appendChild(button2);
      }
      if (copyButton) row.appendChild(copyButton);
      wrapper.appendChild(row);
    }
    async function sendFeedback(messageIndex, value) {
      try {
        await fetch(options.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            feedback: { conversationId: state.conversationId, messageIndex, value }
          })
        });
      } catch {
      }
    }
    async function ask(question) {
      const text2 = question.trim();
      if (!text2 && state.staged.length === 0 || state.busy) return;
      errorBox.hidden = true;
      state.busy = true;
      send.disabled = true;
      if (dictation?.recording) dictation.cancel();
      input.dataset.beforeDictation = "";
      const sending = state.staged;
      state.staged = [];
      paintTray();
      const outgoing = { role: "user", content: text2 };
      if (sending.length > 0) outgoing.attachments = sending;
      state.messages.push(outgoing);
      paintMessage(outgoing);
      emit("message", { text: text2 });
      state.suggestions = [];
      paintSuggestions();
      state.controller = new AbortController();
      await runTurn(void 0, sending);
      state.busy = false;
      send.disabled = false;
      state.controller = null;
      scrollToEnd();
      input.focus();
    }
    async function runTurn(actionResults, sending) {
      const { bubble, wrapper } = paintMessage({ role: "assistant", content: "" });
      log.setAttribute("aria-busy", "true");
      const typing = document.createElement("span");
      typing.className = "typing";
      typing.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      bubble.appendChild(typing);
      const answer = { role: "assistant", content: "" };
      let sources = [];
      const requested = [];
      await streamChat(
        options.endpoint,
        {
          messages: state.messages,
          conversationId: state.conversationId,
          userId: options.userId,
          userHash: options.userHash,
          contact: options.contact,
          actionResults,
          // Only on the first pass. The second half of a paused turn resumes a
          // question the server has already read the files for.
          ...sending && sending.length > 0 ? { attachments: sending } : {}
        },
        {
          onSources: (refs) => {
            sources = refs;
          },
          onDelta: (delta) => {
            typing.remove();
            answer.content += delta;
            bubble.replaceChildren(renderMarkdown(answer.content));
            scrollToEnd();
          },
          onError: (message) => {
            typing.remove();
            showError(message);
            emit("error", { message });
          },
          onFrame: (frame) => handleFrame(frame, requested)
        },
        state.controller?.signal,
        strings
      ).finally(() => {
        typing.remove();
        log.setAttribute("aria-busy", "false");
      });
      if (requested.length > 0 && !actionResults) {
        wrapper.remove();
        const form = requested.find((request) => request.payload?.form);
        if (form) {
          awaitingForm = { name: form.name, input: form.input };
          const node = renderForm(form.payload?.form, uiContext);
          const holder = document.createElement("div");
          holder.className = "msg";
          holder.dataset.role = "assistant";
          holder.appendChild(node);
          log.appendChild(holder);
          scrollToEnd();
          return;
        }
        const results = await runClientActions(requested);
        await runTurn(results);
        return;
      }
      if (answer.content.trim()) {
        answer.sources = citedOnly(sources, answer.content);
        state.messages.push(answer);
        paintSources(wrapper, answer.sources);
        paintFeedback(wrapper, state.messages.length - 1, answer.content);
        persist(options.endpoint, state.messages, options.persist !== false);
        emit("response", { text: answer.content, sources: answer.sources });
      } else {
        wrapper.remove();
      }
      paintSuggestions();
    }
    function handleFrame(frame, requested) {
      if (frame.type === "client-action") {
        requested.push({ id: frame.id, name: frame.name, input: frame.input, payload: frame.payload });
      } else if (frame.type === "suggestions") {
        state.suggestions = frame.items;
      } else if (frame.type === "action") {
        emit("action", { name: frame.name, status: frame.status });
      } else if (frame.type === "captured") {
        emit("captured", { kind: frame.kind, name: frame.name, values: frame.values });
      } else if (frame.type === "notice") {
        paintNotice(frame.message);
      } else if (frame.type === "handoff") {
        emit("handoff", { ticketId: frame.ticketId, message: frame.message });
        paintNotice(frame.message);
      } else if (frame.type === "ui") {
        const node = renderUi({ kind: frame.kind, id: frame.id, data: frame.data }, uiContext);
        if (node) {
          const wrapper = document.createElement("div");
          wrapper.className = "msg";
          wrapper.dataset.role = "assistant";
          wrapper.appendChild(node);
          log.appendChild(wrapper);
          scrollToEnd();
        }
      }
    }
    const uiContext = {
      submit: (value) => void ask(value),
      respond: (values) => void continueWithResult(values),
      run: async (name, payload) => {
        const handler = handlers[name];
        if (!handler) throw new Error("That is not available here");
        return handler(payload);
      }
    };
    let awaitingForm = null;
    async function continueWithResult(values) {
      const pending = awaitingForm;
      awaitingForm = null;
      if (!pending || state.busy) return;
      state.busy = true;
      send.disabled = true;
      state.controller = new AbortController();
      await runTurn([{ name: pending.name, input: pending.input, output: values }]);
      state.busy = false;
      send.disabled = false;
      state.controller = null;
    }
    async function runClientActions(requested) {
      return Promise.all(
        requested.map(async (request) => {
          const handler = handlers[request.name];
          if (!handler) {
            return { name: request.name, input: request.input, output: { error: "no handler registered on this page" } };
          }
          try {
            return { name: request.name, input: request.input, output: await handler(request.input) };
          } catch (error) {
            return {
              name: request.name,
              input: request.input,
              output: { error: error instanceof Error ? error.message : String(error) }
            };
          }
        })
      );
    }
    function paintAttached(wrapper, files) {
      const row = document.createElement("div");
      row.className = "attached";
      for (const file of files) {
        if (file.mimeType.startsWith("image/")) {
          const thumb = document.createElement("img");
          thumb.src = file.dataUrl;
          thumb.alt = file.name;
          row.appendChild(thumb);
          continue;
        }
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = file.name;
        row.appendChild(chip);
      }
      wrapper.appendChild(row);
    }
    function paintNotice(message) {
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = message;
      log.appendChild(notice);
      scrollToEnd();
    }
    function showInvite() {
      if (inline || !options.invite) return;
      if (panel.dataset.open === "true") return;
      try {
        if (sessionStorage.getItem(inviteKey(options.endpoint))) return;
      } catch {
      }
      const bubble = document.createElement("div");
      bubble.className = `invite ${side}`;
      bubble.setAttribute("role", "button");
      bubble.tabIndex = 0;
      bubble.appendChild(document.createTextNode(options.invite));
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "invite-dismiss";
      dismiss.setAttribute("aria-label", strings.dismiss);
      dismiss.appendChild(icon(ICONS.close, false));
      const close2 = () => {
        bubble.remove();
        try {
          sessionStorage.setItem(inviteKey(options.endpoint), "1");
        } catch {
        }
      };
      dismiss.addEventListener("click", (event) => {
        event.stopPropagation();
        close2();
      });
      const open = () => {
        close2();
        setOpen(true);
      };
      bubble.addEventListener("click", open);
      bubble.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      bubble.appendChild(dismiss);
      root.appendChild(bubble);
    }
    if (options.invite && !inline) {
      const delay = options.inviteDelay ?? 4e3;
      const timer = setTimeout(showInvite, delay);
      invites.push(timer);
    }
    launcher.addEventListener("click", () => setOpen(panel.dataset.open !== "true"));
    close.addEventListener("click", () => setOpen(false));
    forget.addEventListener("click", () => {
      if (typeof window.confirm === "function" && !window.confirm(strings.deleteConfirm)) return;
      void forgetConversation();
    });
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      const text2 = input.value;
      input.value = "";
      input.style.height = "auto";
      void ask(text2);
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !inline) setOpen(false);
    });
    repaint();
    const api = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      ask,
      /** Subscribes to widget events. Returns an unsubscribe function. */
      on(name, listener) {
        const set = listeners.get(name) ?? /* @__PURE__ */ new Set();
        set.add(listener);
        listeners.set(name, set);
        return () => set.delete(listener);
      },
      /** Registers a handler for an action the agent can ask the page to run. */
      handle(name, handler) {
        handlers[name] = handler;
      },
      clear() {
        forgetLocally();
      },
      /** Forgets the conversation here and asks the server to do the same. */
      forget: () => forgetConversation(),
      destroy() {
        state.controller?.abort();
        for (const timer of invites) clearTimeout(timer);
        host.remove();
      },
      element: host
    };
    if (options.deepLink !== false) openDeepLink(api);
    return api;
  }
  function applyTheme(host, theme) {
    if (theme !== "auto") {
      host.setAttribute("data-theme", theme);
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => host.setAttribute("data-theme", query.matches ? "dark" : "light");
    sync();
    query.addEventListener("change", sync);
  }
  function icon(path, filled) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", filled ? "currentColor" : "none");
    svg.setAttribute("stroke", filled ? "none" : "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", path);
    svg.appendChild(node);
    return svg;
  }
  function restore(endpoint) {
    try {
      const raw = sessionStorage.getItem(storageKey(endpoint));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function persist(endpoint, messages, enabled) {
    if (!enabled) return;
    try {
      sessionStorage.setItem(storageKey(endpoint), JSON.stringify(messages.slice(-20)));
    } catch {
    }
  }
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("unreadable"));
      reader.readAsDataURL(file);
    });
  }

  // src/embed.ts
  function readConfig() {
    const script = document.currentScript;
    const data = script?.dataset ?? {};
    const endpoint = data.endpoint ?? window.recourseConfig?.endpoint;
    if (!endpoint) {
      console.warn("[recourse] no data-endpoint on the script tag, widget not mounted");
      return null;
    }
    const target = data.target ? document.querySelector(data.target) : null;
    return {
      endpoint,
      userId: data.userId,
      userHash: data.userHash,
      feedback: data.feedback !== "false",
      invite: data.invite,
      inviteDelay: data.inviteDelay ? Number(data.inviteDelay) : void 0,
      title: data.title,
      subtitle: data.subtitle,
      greeting: data.greeting,
      accent: data.accent,
      suggestions: data.suggestions?.split("|").map((item) => item.trim()).filter(Boolean),
      position: data.position === "bottom-left" ? "bottom-left" : "bottom-right",
      theme: data.theme === "dark" || data.theme === "light" ? data.theme : "auto",
      open: data.open === "true",
      persist: data.persist !== "false",
      // `data-deep-link="false"` stops the widget reading `?recourse_q=` out of
      // the page URL.
      deepLink: data.deepLink !== "false",
      // `data-attachments="true"` turns the paperclip on; a number caps the size
      // in megabytes, so `data-attachments="4"` is a 4MB limit.
      ...attachmentsFrom(data.attachments),
      // `data-dictation="true"` adds the mic. `data-dictation-lang` overrides
      // the page language; `data-dictation-cloud="true"` permits the browser's
      // default when on-device recognition is unavailable.
      ...data.dictation === "true" ? {
        dictation: {
          ...data.dictationLang ? { lang: data.dictationLang } : {},
          ...data.dictationCloud === "true" ? { allowCloudFallback: true } : {}
        }
      } : {},
      // `data-call="/api/voice/token"` adds the call button, pointed at the
      // route that mints a signed URL. A path rather than a flag, because there
      // is nothing sensible to default it to: only the host knows where they
      // mounted it.
      ...data.call ? { call: data.call } : {},
      // `data-copy="false"` and `data-delete="true"`, since a data attribute is
      // a string and everything else here reads one.
      copy: data.copy !== "false",
      allowDelete: data.delete === "true",
      ...window.recourseConfig,
      ...target ? { target } : {}
    };
  }
  function attachmentsFrom(value) {
    if (!value || value === "false") return {};
    if (value === "true") return { attachments: true };
    const megabytes = Number(value);
    return Number.isFinite(megabytes) && megabytes > 0 ? { attachments: { maxBytes: Math.round(megabytes * 1024 * 1024) } } : {};
  }
  var config = readConfig();
  if (config) {
    const mount = () => {
      window.recourse = createWidget(config);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
  }
})();
