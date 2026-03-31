/**
 * tongues — invisible automatic translation
 * <script src="https://tongues.80x24.ai/t.js" defer></script>
 */
declare const __VERSION__: string;

if (!(window as any).__tongues) {
  (window as any).__tongues = true;

  // --- Constants ---

  const SKIP_TAGS = new Set(
    "SCRIPT,STYLE,NOSCRIPT,SVG,TEMPLATE,CODE,PRE,KBD,SAMP,VAR,CANVAS,VIDEO,AUDIO,IFRAME,MATH".split(",")
  );
  const INLINE_TAGS = new Set(
    "STRONG,EM,B,I,U,S,CODE,A,SPAN,MARK,SUB,SUP,SMALL,ABBR,CITE,DFN,TIME,Q".split(",")
  );
  const VOID_TAGS = new Set("BR,IMG,WBR".split(","));
  const TRANSLATABLE_ATTRS = ["placeholder", "title", "alt", "aria-label"];
  const REACTIVE_BINDINGS = "x-text,x-html,v-text,v-html,:textContent,:innerHTML".split(",");
  const NO_TRANSLATE = '.notranslate,[translate="no"]';
  const LANG_REGEX = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;
  const BATCH_SIZE = 17;
  const MAX_PARALLEL = 10;
  const MAX_RETRIES = 3;

  // --- State ---

  let apiBase = "";
  let hostname = "";
  let locale = "";
  let initialLocale = "";
  let sourceLang = "";
  let isManual = false;
  let preprompt = "";
  let isBusy = false;
  let isDone = false;
  let isQueued = false;
  let observer: MutationObserver | null = null;
  let debounceTimer: any = null;

  // --- Config ---

  function configure(): boolean {
    const script = (document.currentScript ||
      document.querySelector("script[src*='t.js']")) as HTMLScriptElement | null;
    if (!script) return false;

    apiBase = (script.src || "").replace(/\/t\.js.*$/, "");
    hostname = location.hostname;
    initialLocale = locale = (navigator.language || "en").split("-")[0];
    sourceLang = (script.getAttribute("data-lang") || "").split("-")[0];
    isManual = script.hasAttribute("data-manual");
    preprompt = (script.getAttribute("data-preprompt") || "").trim().slice(0, 30);

    const style = document.createElement("style");
    style.textContent =
      ".t-ing{animation:t-p 1.5s ease-in-out infinite}" +
      "@keyframes t-p{0%,100%{opacity:1}50%{opacity:.4}}";
    document.head.appendChild(style);

    return true;
  }

  // --- DOM helpers ---

  function selectAll(selector: string) {
    return document.querySelectorAll(selector);
  }

  function hasInlineChildrenOnly(el: Element): boolean {
    for (const child of el.children) {
      if (!INLINE_TAGS.has(child.tagName) && !VOID_TAGS.has(child.tagName)) return false;
      for (const binding of REACTIVE_BINDINGS) {
        if (child.hasAttribute(binding)) return false;
      }
    }
    return true;
  }

  // --- Collect ---

  function collect(incremental: boolean, root?: Element) {
    const textMap = new Map<string, Element[]>();
    const attrMap = new Map<string, { el: Element; attr: string }[]>();
    const htmlElements = new WeakSet<Element>();

    const walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const el = node as Element;
          const noTranslate = el.closest(NO_TRANSLATE);

          if (SKIP_TAGS.has(el.tagName) || (noTranslate && noTranslate !== root)) {
            return NodeFilter.FILTER_REJECT;
          }
          if ((el as HTMLElement).isContentEditable) {
            return NodeFilter.FILTER_REJECT;
          }
          if (el.parentElement && htmlElements.has(el.parentElement)) {
            return NodeFilter.FILTER_SKIP;
          }
          if (incremental && el.hasAttribute("data-th")) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = el.textContent?.trim();
          if (!text) return NodeFilter.FILTER_SKIP;

          if (el.children.length > 0) {
            if (!hasInlineChildrenOnly(el)) return NodeFilter.FILTER_SKIP;
            htmlElements.add(el);
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as Element;
      const savedOriginal = el.getAttribute("data-th");
      let text: string;

      if (savedOriginal) {
        text = savedOriginal.trim();
      } else if (htmlElements.has(el)) {
        text = el.innerHTML.trim();
      } else {
        text = el.textContent!.trim();
      }

      if (text) {
        const list = textMap.get(text) || [];
        list.push(el);
        textMap.set(text, list);
      }
    }

    // Collect translatable attributes
    const searchRoot = root || document.body;
    for (const el of searchRoot.querySelectorAll("[placeholder],[title],[alt],[aria-label]")) {
      const noTranslate = el.closest(NO_TRANSLATE);
      if ((noTranslate && noTranslate !== root) || (el as HTMLElement).isContentEditable || SKIP_TAGS.has(el.tagName)) {
        continue;
      }

      for (const attr of TRANSLATABLE_ATTRS) {
        const savedOriginal = el.getAttribute(`data-ta-${attr}`);
        const value = (savedOriginal || el.getAttribute(attr))?.trim();
        if (!value || (incremental && savedOriginal)) continue;

        const list = attrMap.get(value) || [];
        list.push({ el, attr });
        attrMap.set(value, list);
      }
    }

    return { textMap, attrMap };
  }

  // --- Apply ---

  function fadeIn(el: Element) {
    el.classList.remove("t-ing");
    const style = (el as HTMLElement).style;
    style.transition = "none";
    style.opacity = "0.3";
    void (el as HTMLElement).offsetHeight; // force reflow
    style.transition = "opacity .4s ease-in";
    style.opacity = "1";
    el.addEventListener("transitionend", () => {
      style.opacity = "";
      style.transition = "";
    }, { once: true });
  }

  function applyTranslations(
    textMap: Map<string, Element[]>,
    attrMap: Map<string, { el: Element; attr: string }[]>,
    translations: Map<string, string>
  ) {
    pauseObserver();
    try {
      for (const [original, translated] of translations) {
        // Same text — just mark as processed
        if (original === translated) {
          for (const el of textMap.get(original) || []) {
            if (!el.hasAttribute("data-th")) el.setAttribute("data-th", el.innerHTML);
            el.classList.remove("t-ing");
          }
          for (const { el, attr } of attrMap.get(original) || []) {
            if (!el.hasAttribute(`data-ta-${attr}`)) el.setAttribute(`data-ta-${attr}`, original);
          }
          continue;
        }

        // Apply text translations
        const elements = textMap.get(original);
        if (elements) {
          for (const el of elements) {
            if (!el.hasAttribute("data-th")) el.setAttribute("data-th", el.innerHTML);
            el.innerHTML = translated;
            fadeIn(el);
          }
        }

        // Apply attribute translations
        for (const { el, attr } of attrMap.get(original) || []) {
          if (!el.hasAttribute(`data-ta-${attr}`)) el.setAttribute(`data-ta-${attr}`, original);
          el.setAttribute(attr, translated);
        }
      }
    } finally {
      resumeObserver();
    }
  }

  function undoTranslations() {
    pauseObserver();
    try {
      // Clear pulse animations
      selectAll(".t-ing").forEach((el) => {
        el.classList.remove("t-ing");
        const style = (el as HTMLElement).style;
        style.opacity = "";
        style.transition = "";
      });

      // Restore original text
      selectAll("[data-th]").forEach((el) => {
        el.innerHTML = el.getAttribute("data-th")!;
        el.removeAttribute("data-th");
        fadeIn(el);
      });

      // Restore original attributes
      for (const attr of TRANSLATABLE_ATTRS) {
        const dataAttr = `data-ta-${attr}`;
        selectAll(`[${dataAttr}]`).forEach((el) => {
          el.setAttribute(attr, el.getAttribute(dataAttr)!);
          el.removeAttribute(dataAttr);
        });
      }
    } finally {
      resumeObserver();
    }
  }

  // --- Cache (localStorage) ---

  function cacheKey() {
    return `t:${hostname}:${locale}:${__VERSION__}`;
  }

  function loadCache(): Map<string, string> {
    try {
      const raw = localStorage.getItem(cacheKey());
      return raw ? new Map(JSON.parse(raw)) : new Map();
    } catch {
      return new Map();
    }
  }

  function saveCache(translations: Map<string, string>) {
    try {
      const merged = loadCache();
      for (const [key, value] of translations) merged.set(key, value);
      localStorage.setItem(cacheKey(), JSON.stringify([...merged]));
    } catch {}
  }

  // --- Translate ---

  async function translate(incremental = false, root?: Element) {
    if (isBusy) return;
    isBusy = true;

    if (!incremental && !root) {
      isDone = false;
    }

    const { textMap, attrMap } = collect(incremental, root);
    const allTexts = [...new Set([...textMap.keys(), ...attrMap.keys()])];

    if (!allTexts.length) {
      isBusy = false;
      return;
    }

    // Start pulse animation on all collected elements
    for (const elements of textMap.values()) {
      for (const el of elements) {
        el.classList.add("t-ing");
      }
    }

    // Check localStorage cache
    const cached = loadCache();
    const hits = new Map<string, string>();
    const misses: string[] = [];

    for (const text of allTexts) {
      const cachedValue = cached.get(text);
      if (cachedValue !== undefined) {
        hits.set(text, cachedValue);
      } else {
        misses.push(text);
      }
    }

    if (hits.size) applyTranslations(textMap, attrMap, hits);

    // Fetch missing translations from API
    if (misses.length) {
      const pageDescription =
        document.querySelector('meta[name="description"]')?.getAttribute("content") || "";

      const fetchBatch = async (batch: string[]) => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const response = await fetch(`${apiBase}/api/translate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                texts: batch,
                to: locale,
                domain: hostname,
                pageTitle: document.title,
                pageDescription,
                ...(preprompt && { preprompt }),
              }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const translations = new Map(Object.entries(data.translations));
            applyTranslations(textMap, attrMap, translations);
            saveCache(translations);
            return;
          } catch {
            if (attempt < MAX_RETRIES - 1) {
              await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
            }
          }
        }
      };

      // Split into chunks and process in parallel batches
      const chunks: string[][] = [];
      for (let i = 0; i < misses.length; i += BATCH_SIZE) {
        chunks.push(misses.slice(i, i + BATCH_SIZE));
      }
      for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
        await Promise.all(chunks.slice(i, i + MAX_PARALLEL).map(fetchBatch));
      }
    }

    if (!root) isDone = true;
    isBusy = false;

    if (isQueued) {
      isQueued = false;
      setTimeout(() => translate(true), 100);
    }

    resumeObserver();
  }

  // --- Observer ---

  function pauseObserver() {
    observer?.disconnect();
  }

  function resumeObserver() {
    observer?.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRS,
    });
  }

  function setupObserver() {
    observer = new MutationObserver((mutations) => {
      if (isManual) return;

      let dirty = false;
      for (const mutation of mutations) {
        const el = mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;

        if (!el || (el as HTMLElement).isContentEditable) continue;
        if (el.closest(NO_TRANSLATE)) continue;
        if (el.hasAttribute("data-th")) el.removeAttribute("data-th");

        dirty = true;
      }

      if (dirty) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!isBusy) translate(isDone);
          else isQueued = true;
        }, 300);
      }
    });

    resumeObserver();
  }

  // --- Init ---

  async function init() {
    console.log("[open-tongues] https://tongues.80x24.ai");
    if (!configure()) return;
    setupObserver();

    (window as any).t = {
      version: __VERSION__,

      get locale() {
        return locale;
      },

      get sourceLocale() {
        return sourceLang || initialLocale;
      },

      async setLocale(lang: string) {
        if (!lang || lang.length > 35 || !LANG_REGEX.test(lang)) return;
        if (sourceLang && lang === sourceLang) { this.restore(); return; }
        if (lang === locale && isDone) return;
        locale = lang;
        await translate();
      },

      restore() {
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        undoTranslations();
        isDone = false;
        locale = initialLocale;
      },

      async translateEl(target: string | Element | Element[], options?: { to?: string }) {
        const elements = typeof target === "string"
          ? [...document.querySelectorAll(target)]
          : Array.isArray(target) ? target : [target];

        // Restore to source language — undo without API call
        if (options?.to && sourceLang && options.to === sourceLang) {
          pauseObserver();
          try {
            for (const el of elements) {
              if (!(el instanceof Element)) continue;
              el.querySelectorAll("[data-th]").forEach((e) => {
                e.innerHTML = e.getAttribute("data-th")!;
                e.removeAttribute("data-th");
                fadeIn(e);
              });
              for (const attr of TRANSLATABLE_ATTRS) {
                const dataAttr = `data-ta-${attr}`;
                el.querySelectorAll(`[${dataAttr}]`).forEach((e) => {
                  e.setAttribute(attr, e.getAttribute(dataAttr)!);
                  e.removeAttribute(dataAttr);
                });
              }
            }
          } finally {
            resumeObserver();
          }
          return;
        }

        const prevLocale = locale;
        if (options?.to) {
          if (!LANG_REGEX.test(options.to)) return;
          locale = options.to;
        }

        for (const el of elements) {
          if (el instanceof Element) await translate(false, el);
        }

        if (options?.to) locale = prevLocale;
      },
    };

    if (!isManual && !(sourceLang && locale === sourceLang)) {
      await translate();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
} // end singleton guard
