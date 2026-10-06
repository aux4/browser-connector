// Code injected into the target page by background.js. Keep this function
// self-contained: Chrome serializes the function before running it in the tab.
globalThis.aux4PageRuntime = async function aux4PageRuntime(operation, params = {}) {
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };

  const implicitRole = (el) => {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a": return el.hasAttribute("href") ? "link" : null;
      case "button": return "button";
      case "input": {
        const type = (el.type || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["submit", "button", "reset"].includes(type)) return "button";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        return "textbox";
      }
      case "textarea": return "textbox";
      case "select": return "combobox";
      case "nav": return "navigation";
      case "table": return "table";
      case "form": return "form";
      case "ul": case "ol": return "list";
      case "li": return "listitem";
      case "dialog": return "dialog";
      case "option": return "option";
      default: return null;
    }
  };

  const roleOf = (el) => el.getAttribute("role") || implicitRole(el);
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = document.getElementById(labelledBy);
      if (label) return (label.textContent || "").trim().slice(0, 160);
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return (label.textContent || "").trim().slice(0, 160);
      }
      const parent = el.closest("label");
      if (parent) return (parent.textContent || "").trim().slice(0, 160);
      return (el.placeholder || el.title || el.name || "").trim();
    }
    return (el.title || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160);
  };
  const norm = (value) => String(value == null ? "" : value).trim().toLowerCase();
  const nameMatches = (el, wanted) => {
    if (wanted == null || wanted === "") return true;
    const actual = norm(nameOf(el));
    const expected = norm(wanted);
    return actual === expected || actual.includes(expected);
  };
  const bounds = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const interactiveRoles = [
    "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
    "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
  ];
  const componentRoles = {
    table: "table", form: "form", list: "list", navigation: "nav", menu: "menu",
    dialog: "dialog", tablist: "tablist", tree: "tree"
  };

  const snapshotData = (mode = "auto") => {
    if (mode === "off") return null;
    const full = mode === "full";
    const nodes = [];
    const elements = [];
    const components = [];
    let ref = 0;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const role = roleOf(el);
      if (!role || !visible(el)) continue;
      if (interactiveRoles.includes(role)) {
        ref++;
        nodes.push(el);
        const entry = { ref, role, name: nameOf(el), bounds: bounds(el) };
        if (el.disabled || el.getAttribute("aria-disabled") === "true") entry.disabled = true;
        elements.push(entry);
      } else if (componentRoles[role]) {
        const entry = { ref: ++ref, type: componentRoles[role], name: nameOf(el), bounds: bounds(el) };
        if (role === "table") {
          entry.rows = el.querySelectorAll("tr").length;
          entry.headers = Array.from(el.querySelectorAll("thead th, tr:first-child th"))
            .map((th) => (th.textContent || "").trim()).filter(Boolean);
        }
        if (role === "list") entry.items = el.querySelectorAll(":scope > li, :scope > [role='listitem']").length;
        components.push(entry);
      }
    }
    return {
      url: location.href,
      title: document.title,
      elements: full ? elements : elements.slice(0, 50),
      components,
      truncated: full ? 0 : Math.max(0, elements.length - 50)
    };
  };

  const allVisible = () => Array.from(document.querySelectorAll("*"))
    .filter(visible);

  const resolve = (spec = {}) => {
    if (spec.ref != null) {
      const wanted = parseInt(spec.ref, 10);
      let ref = 0;
      for (const el of allVisible()) {
        const role = roleOf(el);
        if (!role) continue;
        if (interactiveRoles.includes(role)) {
          ref++;
          if (ref === wanted) return [el];
        } else if (componentRoles[role]) {
          ref++;
        }
      }
      return [];
    }
    if (spec.selector) {
      try { return Array.from(document.querySelectorAll(spec.selector)).filter(visible); } catch { return []; }
    }
    let candidates = allVisible();
    if (spec.role) candidates = candidates.filter((el) => roleOf(el) === spec.role);
    if (spec.name != null) {
      candidates = candidates.filter((el) => nameMatches(el, spec.name));
      // Labels and containers often have the same accessible text as their
      // control. Prefer the actual interactive control for name-based actions.
      const interactive = candidates.filter((el) => interactiveRoles.includes(roleOf(el)));
      if (interactive.length) candidates = interactive;
    }
    if (spec.text != null) {
      const wanted = norm(spec.text);
      candidates = candidates.filter((el) => norm(el.textContent).includes(wanted));
      candidates.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);
    }
    return candidates;
  };

  const first = (spec) => resolve(spec)[parseInt(spec.index || 1, 10) - 1];
  const requireElement = (spec, description) => {
    const el = first(spec);
    if (!el) throw new Error(`No matching element for ${description || JSON.stringify(spec)}`);
    return el;
  };
  const fire = (el, type, init = {}) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
  const afterAction = () => ({
    status: "ok",
    url: location.href,
    title: document.title
  });

  const waitFor = async (selector, timeout) => {
    const deadline = Date.now() + (parseInt(timeout, 10) || 10000);
    while (Date.now() < deadline) {
      if (!selector || resolve({ selector }).length) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return false;
  };

  const valueFor = (el) => el.value != null ? el.value : (el.textContent || "").trim();
  const fieldSpec = (raw) => {
    const at = String(raw).indexOf("=");
    return { name: (at < 0 ? raw : String(raw).slice(0, at)).trim(), value: at < 0 ? "" : String(raw).slice(at + 1) };
  };

  if (operation === "snapshot") return { snapshot: snapshotData(params.mode || "auto") };
  if (operation === "content" || operation === "read") {
    let root = document.body;
    if (params.selector) {
      try { root = document.querySelector(params.selector); } catch { root = null; }
    }
    if (!root) return { content: "" };
    return { content: params.format === "html" ? root.innerHTML : (root.innerText || root.textContent || "").trim() };
  }
  if (operation === "get-items") {
    let nodes = [];
    try { nodes = params.selector ? Array.from(document.querySelectorAll(params.selector)) : []; } catch {}
    return { items: nodes.map((el) => (el.innerText || el.textContent || "").trim()).filter(Boolean) };
  }
  if (operation === "click-item") {
    let root;
    try { root = document.querySelector(params.selector || "ul, ol, [role='list'], [role='listbox']"); } catch { root = null; }
    if (!root) throw new Error("No list found for click-item");
    const items = Array.from(root.querySelectorAll(":scope > li, :scope > [role='listitem'], :scope > option"));
    const item = /^\d+$/.test(String(params.item))
      ? items[parseInt(params.item, 10) - 1]
      : items.find((el) => norm(el.textContent).includes(norm(params.item)));
    if (!item) throw new Error(`No list item matched "${params.item}"`);
    item.click();
    return afterAction();
  }
  if (operation === "click" || operation === "click-selector" || operation === "click-text") {
    const spec = operation === "click-selector"
      ? { selector: params.selector, index: params.index }
      : operation === "click-text"
        ? { text: params.text, index: params.index }
        : params;
    const el = requireElement(spec, operation);
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return afterAction();
  }
  if (operation === "type" || operation === "clear") {
    const el = requireElement(params, operation);
    if (typeof el.focus === "function") el.focus();
    el.value = operation === "clear" ? "" : String(params.value == null ? "" : params.value);
    fire(el, "input");
    fire(el, "change");
    return { ...afterAction(), value: valueFor(el) };
  }
  if (operation === "fill") {
    const specs = Array.isArray(params.field) ? params.field : (params.field == null ? [] : [params.field]);
    const fields = [];
    for (const raw of specs) {
      const spec = fieldSpec(raw);
      const el = requireElement({ name: spec.name }, `field "${spec.name}"`);
      if (el.tagName === "SELECT") {
        const option = Array.from(el.options).find((o) => o.value === spec.value || o.textContent.trim() === spec.value);
        if (!option) throw new Error(`No option "${spec.value}" for field "${spec.name}"`);
        el.value = option.value;
      } else if (el.type === "checkbox" || el.type === "radio") {
        const checked = ["true", "1", "yes", "on"].includes(norm(spec.value));
        el.checked = checked;
      } else {
        el.value = spec.value;
      }
      fire(el, "input");
      fire(el, "change");
      fields.push({ field: spec.name, role: roleOf(el), value: valueFor(el) });
    }
    return { ...afterAction(), status: "ok", filled: fields.length, fields };
  }
  if (operation === "select") {
    const el = requireElement(params, "select");
    const option = Array.from(el.options || []).find((o) => o.value === String(params.value) || o.textContent.trim() === String(params.value));
    if (!option) throw new Error(`No option "${params.value}"`);
    el.value = option.value;
    fire(el, "input");
    fire(el, "change");
    return { ...afterAction(), value: el.value };
  }
  if (operation === "check" || operation === "uncheck") {
    const el = requireElement(params, operation);
    el.checked = operation === "check";
    fire(el, "input");
    fire(el, "change");
    return { ...afterAction(), checked: el.checked };
  }
  if (operation === "hover") {
    const el = requireElement(params, operation);
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return afterAction();
  }
  if (operation === "press") {
    const el = params.selector || params.name || params.role ? requireElement(params, "press target") : document.activeElement;
    if (el && el.focus) el.focus();
    const event = new KeyboardEvent("keydown", { key: params.key, code: params.key, bubbles: true, cancelable: true });
    (el || document).dispatchEvent(event);
    if (params.key === "Enter" && el && (el.tagName === "BUTTON" || el.type === "submit")) el.click();
    return afterAction();
  }
  if (operation === "scroll") {
    const amount = parseInt(params.amount || params.pixels || 600, 10);
    const direction = params.direction || "down";
    const delta = ["up", "left", "top"].includes(direction) ? -amount : amount;
    const el = params.selector ? requireElement({ selector: params.selector }, "scroll target") : null;
    if (direction === "top") {
      if (el) el.scrollTo({ top: 0, behavior: "smooth" }); else window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (direction === "bottom") {
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); else window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    } else if (el) {
      el.scrollBy({ top: ["up", "down"].includes(direction) ? delta : 0, left: ["left", "right"].includes(direction) ? delta : 0, behavior: "smooth" });
    } else {
      window.scrollBy({ top: ["up", "down"].includes(direction) ? delta : 0, left: ["left", "right"].includes(direction) ? delta : 0, behavior: "smooth" });
    }
    return { ...afterAction(), direction, amount };
  }
  if (operation === "mouse") {
    const x = parseFloat(params.x);
    const y = parseFloat(params.y);
    const el = params.selector ? requireElement({ selector: params.selector }, "mouse target") : document.elementFromPoint(x, y);
    if (!el) throw new Error("No element at the requested coordinates");
    const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
    const action = params.action || "click";
    if (action === "move" || action === "click") el.dispatchEvent(new MouseEvent("mousemove", eventInit));
    if (action === "down" || action === "click") el.dispatchEvent(new MouseEvent("mousedown", eventInit));
    if (action === "up" || action === "click") el.dispatchEvent(new MouseEvent("mouseup", eventInit));
    if (action === "click") el.click();
    return { ...afterAction(), action, x, y };
  }
  if (operation === "wait") {
    if (params.selector === "networkidle" || params.selector === "settle") {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, params.selector === "settle" ? 300 : 500));
      return { status: "ok", mode: params.selector };
    }
    if (String(params.selector || "").startsWith("text=")) {
      const text = String(params.selector).slice(5);
      const deadline = Date.now() + (parseInt(params.timeout, 10) || 10000);
      while (Date.now() < deadline) {
        if (norm(document.body.innerText).includes(norm(text))) return { status: "ok", mode: "text" };
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
    } else if (String(params.selector || "").startsWith("url=")) {
      const expected = String(params.selector).slice(4);
      if (location.href.includes(expected)) return { status: "ok", mode: "url", url: location.href };
    } else if (await waitFor(params.selector, params.timeout)) {
      return { status: "ok" };
    }
    return { timedOut: true, waitedFor: params.selector, timeout: parseInt(params.timeout || 10000, 10), currentUrl: location.href, title: document.title };
  }
  if (operation === "expect") {
    const timeout = parseInt(params.timeout || 5000, 10);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(params.selector)); } catch {}
      const firstNode = nodes[0];
      const text = firstNode ? (firstNode.innerText || firstNode.textContent || "") : "";
      const assertion = params.assertion;
      const pass = assertion === "exist" ? nodes.length > 0
        : assertion === "not_exist" ? nodes.length === 0
          : assertion === "be_visible" ? !!firstNode && visible(firstNode)
            : assertion === "have_text" ? text.includes(String(params.expected))
              : assertion === "have_count" ? nodes.length === parseInt(params.expected, 10)
                : assertion === "have_count_at_least" ? nodes.length >= parseInt(params.expected, 10)
                  : assertion === "have_url" ? location.href.includes(String(params.expected))
                    : assertion === "have_title" ? document.title.includes(String(params.expected))
                      : assertion === "have_attribute" ? (() => { const [a, v] = String(params.expected || "").split("=", 2); return firstNode && firstNode.hasAttribute(a) && (v == null || firstNode.getAttribute(a) === v); })()
                        : false;
      if (pass) return { status: "ok", count: nodes.length, text, url: location.href, title: document.title };
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Expectation failed: ${params.assertion} ${params.selector || ""}`);
  }
  if (operation === "expect-list") {
    const nodes = params.selector ? Array.from(document.querySelectorAll(params.selector)) : [];
    const expected = parseInt(params.expected, 10);
    if (params.assertion === "at_least" && nodes.length < expected) throw new Error(`Expected at least ${expected} items, got ${nodes.length}`);
    if (params.assertion === "contains" && !nodes.some((el) => (el.textContent || "").includes(String(params.expected)))) throw new Error(`Expected list to contain ${params.expected}`);
    return { status: "ok", count: nodes.length };
  }
  if (operation === "upload") {
    const el = requireElement(params, "upload target");
    if (el.type !== "file") throw new Error("Upload target is not a file input");
    const bytes = Uint8Array.from(atob(params.data || ""), (c) => c.charCodeAt(0));
    const file = new File([bytes], params.fileName || "upload.bin", { type: params.mimeType || "application/octet-stream" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    el.files = transfer.files;
    fire(el, "input");
    fire(el, "change");
    return { status: "ok", fileName: file.name, size: file.size };
  }
  if (operation === "component") {
    const type = params.type;
    let el = null;
    if (type === "table") el = Array.from(document.querySelectorAll("table")).find((node) => nameMatches(node, params.name));
    if (type === "list") el = Array.from(document.querySelectorAll("ul,ol,[role='list'],[role='listbox']")).find((node) => nameMatches(node, params.name));
    if (type === "form") el = Array.from(document.querySelectorAll("form")).find((node) => nameMatches(node, params.name));
    if (!el) throw new Error(`Component not found: ${type}${params.name ? ` ${params.name}` : ""}`);
    const action = params.action || "locate";
    if (action === "locate" || action === "bounds") return { status: "ok", type, count: 1, bounds: bounds(el) };
    if (action === "count") return { status: "ok", count: el.children.length };
    if (action === "read") {
      if (type === "table" && params.row != null) {
        const row = el.querySelectorAll("tr")[parseInt(params.row, 10) - 1];
        const cell = row && row.children[typeof params.col === "number" ? params.col - 1 : 0];
        return { status: "ok", text: (cell && cell.textContent || "").trim() };
      }
      if (type === "list" && params.item != null) {
        const item = el.querySelectorAll(":scope > li, :scope > [role='listitem']")[parseInt(params.item, 10) - 1];
        return { status: "ok", text: (item && item.textContent || "").trim() };
      }
      return { status: "ok", text: (el.innerText || el.textContent || "").trim() };
    }
    if (action === "click") { el.click(); return afterAction(); }
    if (action === "hover") { el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return afterAction(); }
    if (action === "scroll") { el.scrollIntoView({ block: "center" }); return afterAction(); }
    throw new Error(`Unsupported component action: ${action}`);
  }
  throw new Error(`Unsupported page operation: ${operation}`);
};
