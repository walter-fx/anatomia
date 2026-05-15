window.addEventListener("DOMContentLoaded", () => {
    initClassClock();
    setAppHeight();
    initDeck().catch((error) => {
        console.error(error);
        renderError(error.message || "Erro ao carregar slides.");
    });
});

const REMOTE_API_BASE = "https://controle_slides.starkfx.com.br";
const SESSION_STORAGE_KEY = "controle_session_code";
const STUDENT_NAME_STORAGE_KEY = "aluno_nome_aula";
const STUDENT_TOKEN = "347c434f99f06225f0c0229c97baacb4859ebbab3821b273";
const AULA_ID = 1;
const FORCED_SESSION_CODE = "NHCFTHXN";
const DEBUG_FLOW = true;
function flow(event, payload = {}) {
    if (!DEBUG_FLOW) return;
    console.log("[SLIDE_FLOW]", new Date().toISOString(), event, payload);
}

async function initDeck() {
    const data = await loadJson("conteudo_apresentacao.json");
    const meta = data.meta || {};
    const slides = Array.isArray(data.slides) ? data.slides : [];

    if (!slides.length) {
        throw new Error("Nenhum slide encontrado em conteudo_apresentacao.json");
    }

    const deck = document.getElementById("deck");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const counter = document.getElementById("counter");
    const progress = document.getElementById("progress");
    const dotRail = document.getElementById("dotRail");
    const modeTela = window.location.hash.includes("tela");
    const sessionCode = getSessionCode() || await resolveActiveSessionCode();

    deck.innerHTML = slides.map((slide, i) => renderSlide(slide, i, meta)).join("");
    dotRail.innerHTML = slides.map(() => "<button class=\"dot\" type=\"button\" aria-label=\"Ir para slide\"></button>").join("");

    const dots = Array.from(dotRail.querySelectorAll(".dot"));
    dots.forEach((dot, index) => {
        dot.addEventListener("click", () => goTo(index));
    });

    let current = 0;
    let wheelLock = false;
    let remoteFollowActive = false;
    let slideHeight = window.innerHeight;
    let touchStartedInsideScrollable = false;
    const isMobileDeck = () => window.matchMedia("(max-width: 1024px)").matches;
    const getSlideNodes = () => Array.from(deck.querySelectorAll(".slide"));


    const getScrollableContainer = (target) => {
        if (!(target instanceof Element)) {
            return null;
        }
        const container = target.closest(".slide-main");
        if (!container) {
            return null;
        }
        return container.scrollHeight > container.clientHeight + 2 ? container : null;
    };

    const syncMinimizedPreviewToActiveSlide = () => {
        if (document.body.classList.contains("media-focus-mode")) {
            return;
        }

        const slidesNodes = getSlideNodes();
        const activeSlide = slidesNodes[current];
        const activePreview = activeSlide?.querySelector("[data-media-preview]");
        if (!activePreview) {
            return;
        }

        const hideMinimizedOnActive = isMobileDeck() && activePreview.classList.contains("hero-qr-preview");

        const minimizedPreviews = Array.from(document.querySelectorAll(".media-preview.media-minimized"));
        if (hideMinimizedOnActive) {
            minimizedPreviews.forEach((preview) => {
                if (preview.__media?.setMinimized) {
                    preview.__media.setMinimized(false);
                    return;
                }
                preview.classList.remove("media-minimized");
            });
            return;
        }

        if (!minimizedPreviews.length) {
            if (isMobileDeck() && activePreview.__media?.setMinimized) {
                activePreview.__media.setMinimized(true);
            }
            return;
        }

        minimizedPreviews.forEach((preview) => {
            if (preview === activePreview) {
                return;
            }
            if (preview.__media?.setMinimized) {
                preview.__media.setMinimized(false);
                return;
            }
            preview.classList.remove("media-minimized");
        });

        if (!activePreview.classList.contains("media-minimized") && activePreview.__media?.setMinimized) {
            activePreview.__media.setMinimized(true);
        }
    };

    const collapseMediaOnSlideChange = () => {
        const previews = Array.from(document.querySelectorAll("[data-media-preview]"));
        previews.forEach((preview) => {
            preview.__media?.close?.();
        });
    };

    function goTo(index) {
        collapseMediaOnSlideChange();
        current = clamp(index, 0, slides.length - 1);
        flow("goto_local", { current: current + 1 });
        deck.style.transform = `translateY(-${current * slideHeight}px)`;

        getSlideNodes().forEach((node, idx) => {
            node.classList.toggle("is-active", idx === current);
            node.classList.toggle("is-before", idx < current);
            node.classList.toggle("is-after", idx > current);
        });

        dots.forEach((dot, idx) => dot.classList.toggle("active", idx === current));

        counter.textContent = `${current + 1} / ${slides.length}`;
        progress.style.setProperty("--w", `${((current + 1) / slides.length) * 100}%`);
        prevBtn.disabled = current === 0;
        nextBtn.disabled = current === slides.length - 1;
        syncMinimizedPreviewToActiveSlide();
    }

    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    prevBtn.addEventListener("click", () => { if (!remoteFollowActive) prev(); });
    nextBtn.addEventListener("click", () => { if (!remoteFollowActive) next(); });
    window.addEventListener("resize", () => {
        setAppHeight();
        slideHeight = window.innerHeight;
        goTo(current);
    });

    window.addEventListener("keydown", (event) => {
        if (document.body.classList.contains("media-focus-mode")) {
            if (event.key === "Escape") {
                document.dispatchEvent(new CustomEvent("media:close"));
            }
            return;
        }
        if (["ArrowRight"].includes(event.key)) {
            if (remoteFollowActive) return;
            event.preventDefault();
            next();
        }
        if (["ArrowLeft"].includes(event.key)) {
            if (remoteFollowActive) return;
            event.preventDefault();
            prev();
        }
    });

    window.addEventListener("wheel", (event) => {
        if (document.body.classList.contains("media-focus-mode")) {
            return;
        }
        if (getScrollableContainer(event.target)) {
            return;
        }
        if (remoteFollowActive) {
            return;
        }
        if (wheelLock || Math.abs(event.deltaY) < 24) {
            return;
        }

        wheelLock = true;
        event.deltaY > 0 ? next() : prev();

        setTimeout(() => {
            wheelLock = false;
        }, 450);
    }, { passive: true });

    let startY = 0;
    window.addEventListener("touchstart", (event) => {
        startY = event.changedTouches[0].clientY;
        touchStartedInsideScrollable = Boolean(getScrollableContainer(event.target));
    }, { passive: true });

    window.addEventListener("touchend", (event) => {
        if (document.body.classList.contains("media-focus-mode")) {
            return;
        }
        if (touchStartedInsideScrollable) {
            touchStartedInsideScrollable = false;
            return;
        }
        if (remoteFollowActive) {
            return;
        }
        const delta = startY - event.changedTouches[0].clientY;
        if (Math.abs(delta) < 45) {
            return;
        }
        delta > 0 ? next() : prev();
    }, { passive: true });

    bindQuizToggle();
    bindMediaFullscreen();
    bindDoubtsPanel({ modeTela, sessionCode });
    bindRemoteSession({
        sessionCode,
        goTo,
        getCurrent: () => current,
        getPreview: () => getSlideNodes()[current]?.querySelector("[data-media-preview]"),
        shouldFollow: (sessionItem) => Boolean(sessionItem?.acompanhar_ativo),
        onFollowChange: (isOn) => {
            remoteFollowActive = Boolean(isOn);
            prevBtn.disabled = remoteFollowActive || current === 0;
            nextBtn.disabled = remoteFollowActive || current === slides.length - 1;
            dots.forEach((dot) => {
                dot.disabled = remoteFollowActive;
                dot.style.pointerEvents = remoteFollowActive ? "none" : "auto";
                dot.style.opacity = remoteFollowActive ? "0.45" : "1";
            });
        }
    });
    slideHeight = window.innerHeight;
    goTo(0);
}

async function loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Falha ao carregar ${path}`);
    }
    return response.json();
}

function renderSlide(slide, index, meta) {
    const layout = slide.layout || "split-cards";
    const titleTag = index === 0 ? "h1" : "h2";
    const bulletsHtml = renderBullets(slide.bullets);
    const chipsHtml = renderChips(slide.chips);
    const img = escapeHtml(slide.imagem || "");

    const header = `
        <p class="kicker">${escapeHtml(slide.kicker || meta.titulo || "Aula")}</p>
        <${titleTag}>${escapeHtml(slide.titulo || "")}</${titleTag}>
        <p class="subtitle">${escapeHtml(slide.subtitulo || "")}</p>
    `;

    let mainBody = `${bulletsHtml}${chipsHtml}`;
    let sideBody = renderImage(img, slide.titulo || "Slide");

    if (layout === "case-columns") {
        mainBody = `
            <div class="cases-grid">
                ${(slide.casos || []).map((c) => `
                    <article class="case-card">
                        <h3>${escapeHtml(c.titulo || "Caso")}</h3>
                        <p><strong>Situação:</strong> ${escapeHtml(c.situacao || "")}</p>
                        <p><strong>Conduta:</strong> ${escapeHtml(c.conduta || "")}</p>
                    </article>
                `).join("")}
            </div>
        `;
    }

    if (layout === "quiz-accordion") {
        mainBody = `
            <div class="quiz-list">
                ${(slide.questoes || []).map((q, idx) => `
                    <article class="quiz-item" data-quiz>
                        <button class="quiz-question" type="button" aria-expanded="false">
                            <span>${idx + 1}. ${escapeHtml(q.pergunta || "Pergunta")}</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </button>
                        <div class="quiz-answer">
                            <p>${escapeHtml(q.resposta || "Resposta não disponível")}</p>
                        </div>
                    </article>
                `).join("")}
            </div>
        `;
    }

    if (layout === "references-wall") {
        mainBody = `
            <div class="references-grid">
                ${(slide.referencias || []).map((r) => renderReference(r)).join("")}
            </div>
        `;
    }

    if (layout === "hero-wave") {
        sideBody = `
            <div class="hero-site-preview hero-qr-preview media-preview" data-media-preview>
                <div class="hero-site-topbar">
                    <span class="browser-dot red"></span>
                    <span class="browser-dot yellow"></span>
                    <span class="browser-dot green"></span>
                    <span class="address-bar">starkfx.com.br/aulas</span>
                </div>
                <div class="hero-site-body hero-qr-body">
                    <div class="media-loader" aria-hidden="true">
                        <span class="media-loader-spinner"></span>
                    </div>
                    <img class="hero-main-qr" src="assets/qr/qr-code.png" alt="QR Code da aula" loading="lazy" />
                </div>
            </div>
        `;
        mainBody = `
            ${bulletsHtml}
            <div class="chips"><span class="chip">Carga horária: ${escapeHtml(meta.carga_horaria || "")}</span></div>
        `;
    }

    return `
        <section class="slide layout-${escapeHtml(layout)} ${index === 0 ? "is-active" : "is-after"}">
            <div class="slide-main">
                ${header}
                ${mainBody}
            </div>
            <aside class="slide-side">
                ${sideBody}
            </aside>
        </section>
    `;
}

function renderImage(src, alt) {
    return `
        <div class="hero-site-preview media-preview" data-media-preview>
            <div class="hero-site-topbar">
                <span class="browser-dot red"></span>
                <span class="browser-dot yellow"></span>
                <span class="browser-dot green"></span>
                <span class="address-bar">starkfx.com.br/aulas</span>
            </div>
            <div class="media-window-body">
                <div class="media-loader" aria-hidden="true">
                    <span class="media-loader-spinner"></span>
                </div>
                <img class="media-main-image" src="${src}" alt="${escapeHtml(alt)}" loading="lazy" />
            </div>
        </div>
    `;
}

function renderBullets(items) {
    if (!Array.isArray(items) || !items.length) {
        return "";
    }
    return `<ul class="bullet-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReference(item) {
    if (!item) {
        return "";
    }

    if (typeof item === "object" && item.url) {
        const label = escapeHtml(item.titulo || item.label || item.url);
        const url = escapeHtml(item.url);
        return `<article class="ref-card"><a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a></article>`;
    }

    return `<article class="ref-card">${escapeHtml(String(item))}</article>`;
}

function renderChips(items) {
    if (!Array.isArray(items) || !items.length) {
        return "";
    }
    return `<div class="chips">${items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function bindQuizToggle() {
    document.querySelectorAll("[data-quiz]").forEach((item) => {
        const btn = item.querySelector(".quiz-question");
        const answer = item.querySelector(".quiz-answer");
        if (!btn || !answer) {
            return;
        }

        btn.addEventListener("click", () => {
            const isOpen = item.classList.contains("open");
            item.classList.toggle("open", !isOpen);
            btn.setAttribute("aria-expanded", String(!isOpen));
            answer.style.maxHeight = !isOpen ? `${answer.scrollHeight + 16}px` : "0px";
        });
    });
}

function bindMediaFullscreen() {
    const previews = Array.from(document.querySelectorAll("[data-media-preview]"));
    if (!previews.length) {
        return;
    }
    const isMobileDeck = () => window.matchMedia("(max-width: 1024px)").matches;

    const refreshMinimizedLayoutState = () => {
        const hasMinimized = document.querySelector(".media-preview.media-minimized") !== null;
        document.body.classList.toggle("has-minimized-media", hasMinimized);
    };

    previews.forEach((preview) => {
        const media = preview.querySelector("img");
        if (!media) {
            return;
        }
        preview.classList.add("is-loading");
        const finishLoading = () => {
            preview.classList.remove("is-loading");
        };
        media.addEventListener("load", finishLoading, { once: true });
        media.addEventListener("error", finishLoading, { once: true });
        if (media.complete && media.naturalWidth > 0) {
            finishLoading();
        }

        media.setAttribute("draggable", "false");
        let expanded = false;
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let dx = 0;
        let dy = 0;
        let clickTimer = null;
        const originalParent = preview.parentElement;
        const originalNext = preview.nextSibling;
        const moveToOrigin = () => {
            if (!originalParent) {
                return;
            }
            if (originalNext && originalNext.parentNode === originalParent) {
                originalParent.insertBefore(preview, originalNext);
            } else {
                originalParent.appendChild(preview);
            }
        };
        const moveToBody = () => {
            if (preview.parentElement !== document.body) {
                document.body.appendChild(preview);
            }
        };
        const isMinimized = () => preview.classList.contains("media-minimized");
        const setMinimized = (value) => {
            preview.classList.toggle("media-minimized", value);
            if (expanded) {
                refreshMinimizedLayoutState();
                return;
            }
            if (value) {
                moveToBody();
                refreshMinimizedLayoutState();
                return;
            }
            moveToOrigin();
            refreshMinimizedLayoutState();
        };
        const clearDrag = () => {
            preview.style.removeProperty("--drag-x");
            preview.style.removeProperty("--drag-y");
            preview.style.removeProperty("--drag-rot");
            preview.classList.remove("media-dragging");
            dx = 0;
            dy = 0;
        };

        const close = () => {
            if (!expanded) {
                return;
            }
            expanded = false;
            clearDrag();
            preview.classList.remove("media-expanded");
            document.body.classList.remove("media-focus-mode");
            moveToOrigin();
            refreshMinimizedLayoutState();
        };

        const open = () => {
            if (expanded) {
                return;
            }
            setMinimized(false);
            expanded = true;
            document.body.appendChild(preview);
            preview.classList.add("media-expanded");
            document.body.classList.add("media-focus-mode");
        };
        preview.__media = { setMinimized, isMinimized, isExpanded: () => expanded, open, close };

        const runSingleClickAction = () => {
            if (isMobileDeck()) {
                if (expanded) {
                    close();
                    setMinimized(true);
                    return;
                }
                if (isMinimized()) {
                    open();
                    return;
                }
                setMinimized(true);
                return;
            }

            if (expanded) {
                close();
                return;
            }
            if (isMinimized()) {
                setMinimized(false);
                return;
            }
            open();
        };

        media.addEventListener("click", (event) => {
            event.stopPropagation();
            if (isMobileDeck()) {
                runSingleClickAction();
                return;
            }
            if (clickTimer) {
                clearTimeout(clickTimer);
            }
            clickTimer = setTimeout(() => {
                clickTimer = null;
                runSingleClickAction();
            }, 220);
        });

        media.addEventListener("dblclick", (event) => {
            if (isMobileDeck()) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            if (expanded) {
                return;
            }
            if (!isMinimized()) {
                setMinimized(true);
            }
        });

        preview.addEventListener("click", () => {
            if (isMobileDeck()) {
                runSingleClickAction();
                return;
            }
            if (expanded) {
                close();
                return;
            }
            if (isMinimized()) {
                setMinimized(false);
            }
        });

        preview.addEventListener("pointerdown", (event) => {
            if (!expanded) {
                return;
            }
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            preview.classList.add("media-dragging");
            preview.setPointerCapture?.(event.pointerId);
        });

        preview.addEventListener("pointermove", (event) => {
            if (!expanded || !dragging) {
                return;
            }
            dx = event.clientX - startX;
            dy = event.clientY - startY;
            preview.style.setProperty("--drag-x", `${dx}px`);
            preview.style.setProperty("--drag-y", `${dy}px`);
            preview.style.setProperty("--drag-rot", `${dx * 0.03}deg`);
        });

        preview.addEventListener("pointerup", (event) => {
            if (!expanded || !dragging) {
                return;
            }
            dragging = false;
            preview.releasePointerCapture?.(event.pointerId);
            const distance = Math.hypot(dx, dy);
            if (distance > 140) {
                close();
                return;
            }
            clearDrag();
        });

        preview.addEventListener("pointercancel", () => {
            dragging = false;
            clearDrag();
        });

        document.addEventListener("media:close", close);
    });

    if (isMobileDeck()) {
        previews.forEach((preview) => {
            if (preview.classList.contains("hero-qr-preview")) {
                preview.__media?.setMinimized(false);
                return;
            }
            preview.__media?.setMinimized(true);
        });
    }
    refreshMinimizedLayoutState();
}

function renderError(message) {
    const deck = document.getElementById("deck");
    if (!deck) {
        return;
    }

    deck.innerHTML = `
        <section class="slide is-active layout-split-cards">
            <div class="slide-main">
                <p class="kicker">Erro</p>
                <h1>Não foi possível carregar os slides</h1>
                <p class="subtitle">${escapeHtml(message)}</p>
            </div>
            <aside class="slide-side"></aside>
        </section>
    `;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function initClassClock() {
    const clock = document.getElementById("classClock");
    const text = document.getElementById("clockText");
    if (!clock || !text) {
        return;
    }

    const updateClock = () => {
        const now = new Date();
        clock.classList.remove("is-blinking", "is-break", "is-end");

        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        text.textContent = `${hh}:${mm}:${ss}`;
    };

    updateClock();
    window.setInterval(updateClock, 1000);
}

function setAppHeight() {
    document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}

function getSessionCode() {
    const fromQuery = new URLSearchParams(window.location.search).get("sessao");
    if (FORCED_SESSION_CODE) {
        localStorage.setItem(SESSION_STORAGE_KEY, FORCED_SESSION_CODE);
        return FORCED_SESSION_CODE;
    }
    if (fromQuery) {
        localStorage.setItem(SESSION_STORAGE_KEY, fromQuery);
        return fromQuery;
    }
    return localStorage.getItem(SESSION_STORAGE_KEY) || "";
}

function setSessionCode(code) {
    if (!code) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return;
    }
    localStorage.setItem(SESSION_STORAGE_KEY, code);
}

async function remoteApi(path, token, options = {}) {
    flow("api_request", { path, method: options.method || "GET" });
    const response = await fetch(`${REMOTE_API_BASE}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            ...(options.headers || {})
        }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        flow("api_error", { path, method: options.method || "GET", status: response.status, data });
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    flow("api_response", { path, method: options.method || "GET", data });
    return data;
}

async function resolveActiveSessionCode() {
    try {
        const data = await remoteApi(`/v1/sessoes-ativas?aula_id=${AULA_ID}`, STUDENT_TOKEN, { method: "GET" });
        const code = data?.item?.codigo ? String(data.item.codigo) : "";
        if (code) {
            setSessionCode(code);
            return code;
        }
    } catch (error) {
        console.error("Falha ao resolver sessao ativa:", error);
    }
    return "";
}

function bindRemoteSession({ sessionCode, goTo, getCurrent, getPreview, shouldFollow, onFollowChange }) {
    let lastImageOpen = null;
    let lastSlideRemote = null;
    let currentSession = sessionCode || "";
    let highlightEl = null;
    let checkActiveCounter = 0;
    const closeAllMedia = () => {
        const previews = Array.from(document.querySelectorAll("[data-media-preview]"));
        previews.forEach((preview) => {
            preview.__media?.close?.();
            preview.__media?.setMinimized?.(false);
        });
        document.body.classList.remove("media-focus-mode");
    };

    const showHighlight = (item) => {
        const isDuvidaHighlight = Boolean(item?.destaque_ativo) && item?.destaque_tipo === "duvida";
        if (!isDuvidaHighlight) {
            if (highlightEl) {
                highlightEl.remove();
                highlightEl = null;
            }
            return;
        }
        if (!highlightEl) {
            highlightEl = document.createElement("div");
            highlightEl.style.position = "fixed";
            highlightEl.style.left = "14px";
            highlightEl.style.bottom = "84px";
            highlightEl.style.zIndex = "110";
            highlightEl.style.maxWidth = "min(560px, calc(100vw - 28px))";
            highlightEl.style.background = "rgba(5,11,23,.95)";
            highlightEl.style.border = "1px solid rgba(155,181,230,.4)";
            highlightEl.style.borderRadius = "12px";
            highlightEl.style.padding = "10px";
            highlightEl.style.color = "#eaf2ff";
            highlightEl.style.fontFamily = "Outfit, sans-serif";
            document.body.appendChild(highlightEl);
        }
        highlightEl.innerHTML = `
          <p style="margin:0 0 6px;font-size:12px;opacity:.8;">❓ Dúvida • ${escapeHtml(item.destaque_nome || "Aluno")}</p>
          <p style="margin:0;">${escapeHtml(item.destaque_mensagem || "")}</p>
        `;
    };

    const tick = async () => {
        try {
            // Revalida periodicamente a sessao ativa para nao ficar preso em sessao antiga
            checkActiveCounter += 1;
            if (!currentSession || checkActiveCounter % 6 === 0) {
                const activeCode = await resolveActiveSessionCode();
                if (activeCode && activeCode !== currentSession) {
                    flow("session_switch", { from: currentSession, to: activeCode });
                    currentSession = activeCode;
                    lastImageOpen = null;
                }
                if (!currentSession) {
                    return;
                }
            }
            const data = await remoteApi(`/v1/sessoes/${currentSession}`, STUDENT_TOKEN, { method: "GET" });
            const item = data.item || {};
            if (item.status && item.status !== "aberta") {
                flow("session_closed_detected", { currentSession, status: item.status });
                currentSession = "";
                setSessionCode("");
                return;
            }
            const slideRemote = Math.max(1, Number(item.slide_atual || 1));
            const imageOpen = Boolean(item.imagem_aberta);
            flow("remote_tick", { session: currentSession, slideRemote, imageOpen, localCurrent: getCurrent() + 1, follow: shouldFollow(item) });
            showHighlight(item);
            onFollowChange?.(shouldFollow(item));

            if (shouldFollow(item) && slideRemote - 1 !== getCurrent()) {
                goTo(slideRemote - 1);
            }

            const slideChanged = slideRemote !== lastSlideRemote;
            if (imageOpen !== lastImageOpen || (imageOpen && slideChanged)) {
                if (imageOpen) {
                    flow("remote_image_open", { slideLocal: getCurrent() + 1, slideRemote });
                    window.requestAnimationFrame(() => {
                        const preview = getPreview();
                        preview?.__media?.setMinimized?.(false);
                        preview?.__media?.open?.();
                    });
                } else {
                    flow("remote_image_close_all", { slideLocal: getCurrent() + 1 });
                    closeAllMedia();
                }
                lastImageOpen = imageOpen;
            }
            lastSlideRemote = slideRemote;
        } catch (error) {
            console.error("Falha no sync remoto:", error);
            currentSession = "";
            setSessionCode("");
        }
    };

    tick();
    window.setInterval(tick, 1200);
}

function bindDoubtsPanel({ modeTela, sessionCode }) {
    if (modeTela) {
        let currentSession = sessionCode || "";
        const handBell = document.createElement("div");
        handBell.style.position = "fixed";
        handBell.style.top = "14px";
        handBell.style.right = "14px";
        handBell.style.zIndex = "120";
        handBell.style.width = "54px";
        handBell.style.height = "54px";
        handBell.style.borderRadius = "999px";
        handBell.style.background = "rgba(13,24,43,.96)";
        handBell.style.border = "1px solid rgba(155,181,230,.45)";
        handBell.style.display = "none";
        handBell.style.placeItems = "center";
        handBell.style.fontSize = "24px";
        handBell.style.boxShadow = "0 8px 20px rgba(0,0,0,.35)";
        handBell.innerHTML = `
          <span aria-hidden="true">✋</span>
          <span id="handBadge" style="position:absolute;top:-8px;right:-2px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#d72d2d;color:#fff;font-size:12px;font-weight:700;display:none;align-items:center;justify-content:center;">0</span>
        `;
        document.body.appendChild(handBell);
        const handBadge = handBell.querySelector("#handBadge");
        const load = async () => {
            try {
                if (!currentSession) {
                    currentSession = await resolveActiveSessionCode();
                    if (!currentSession) {
                        handBell.style.display = "none";
                        if (handBadge) {
                            handBadge.style.display = "none";
                        }
                        return;
                    }
                }
                const data = await remoteApi(`/v1/sessoes/${currentSession}/duvidas?status=nova`, STUDENT_TOKEN, { method: "GET" });
                const items = Array.isArray(data.items) ? data.items : [];
                const maoCount = items.length;
                if (handBadge) {
                    if (maoCount > 0) {
                        handBell.style.display = "grid";
                        handBadge.textContent = String(maoCount);
                        handBadge.style.display = "inline-flex";
                    } else {
                        handBell.style.display = "none";
                        handBadge.style.display = "none";
                    }
                }
            } catch (error) {
                currentSession = "";
            }
        };
        load();
        window.setInterval(load, 2500);
        return;
    }

    const fab = document.createElement("div");
    fab.style.position = "fixed";
    fab.style.right = "14px";
    fab.style.bottom = "90px";
    fab.style.zIndex = "80";
    fab.style.display = "grid";
    fab.style.gap = "10px";
    fab.innerHTML = `
      <button id="fabMao" type="button" title="Levantar a mão" style="width:56px;height:56px;border:none;border-radius:999px;background:#5f4a1d;color:#fff;font-size:24px;cursor:pointer;">✋</button>
      <button id="fabDuvida" type="button" title="Enviar dúvida" style="width:56px;height:56px;border:none;border-radius:999px;background:#1d5f59;color:#fff;font-size:24px;cursor:pointer;">?</button>
    `;
    document.body.appendChild(fab);

    const maoBtn = fab.querySelector("#fabMao");
    const duvidaBtn = fab.querySelector("#fabDuvida");
    if (!maoBtn || !duvidaBtn) {
        return;
    }

    maoBtn.addEventListener("click", async () => {
        const alunoNome = await ensureStudentName();
        if (!alunoNome) {
            return;
        }
        let currentSession = sessionCode || getSessionCode() || await resolveActiveSessionCode();
        if (!currentSession) {
            notify("success", "Mão levantada.");
            return;
        }
        try {
            await remoteApi(`/v1/sessoes/${currentSession}/duvidas`, STUDENT_TOKEN, {
                method: "POST",
                body: JSON.stringify({ aluno_nome: alunoNome, mensagem: "", tipo: "mao" })
            });
            notify("success", "Mão levantada enviada.");
        } catch (error) {
            notify("error", `Falha ao enviar: ${error.message}`);
        }
    });

    duvidaBtn.addEventListener("click", async () => {
        const alunoNome = await ensureStudentName();
        if (!alunoNome) {
            return;
        }
        let mensagem = "";
        if (window.Swal) {
            const result = await window.Swal.fire({
                title: "Digite sua dúvida",
                input: "textarea",
                inputPlaceholder: "Escreva sua pergunta",
                showCancelButton: true,
                confirmButtonText: "Enviar",
                cancelButtonText: "Cancelar",
                inputValidator: (value) => (!value || value.trim().length < 4 ? "Digite ao menos 4 caracteres." : null)
            });
            if (!result.isConfirmed) return;
            mensagem = String(result.value || "");
        } else {
            mensagem = String(window.prompt("Digite sua dúvida:") || "");
        }
        if (!mensagem || mensagem.trim().length < 4) return;
        let currentSession = sessionCode || getSessionCode() || await resolveActiveSessionCode();
        if (!currentSession) {
            notify("success", "Dúvida registrada localmente.");
            return;
        }
        try {
            await remoteApi(`/v1/sessoes/${currentSession}/duvidas`, STUDENT_TOKEN, {
                method: "POST",
                body: JSON.stringify({ aluno_nome: alunoNome, mensagem: mensagem.trim(), tipo: "duvida" })
            });
            notify("success", "Dúvida enviada.");
        } catch (error) {
            notify("error", `Falha ao enviar: ${error.message}`);
        }
    });
}

function notify(icon, text) {
    if (window.Swal) {
        window.Swal.fire({
            toast: true,
            position: "top-end",
            timer: 1900,
            showConfirmButton: false,
            icon,
            title: text
        });
        return;
    }
    window.alert(text);
}

async function ensureStudentName() {
    const saved = String(localStorage.getItem(STUDENT_NAME_STORAGE_KEY) || "").trim();
    if (saved) {
        return saved;
    }
    if (window.Swal) {
        const result = await window.Swal.fire({
            title: "Seu nome",
            input: "text",
            inputPlaceholder: "Digite seu nome",
            confirmButtonText: "Salvar",
            showCancelButton: true,
            cancelButtonText: "Cancelar",
            inputValidator: (value) => {
                if (!value || value.trim().length < 2) {
                    return "Informe pelo menos 2 caracteres.";
                }
                return null;
            }
        });
        if (!result.isConfirmed) {
            return "";
        }
        const name = String(result.value || "").trim().slice(0, 120);
        if (!name) {
            return "";
        }
        localStorage.setItem(STUDENT_NAME_STORAGE_KEY, name);
        return name;
    }
    const fallback = window.prompt("Digite seu nome:");
    const name = String(fallback || "").trim().slice(0, 120);
    if (!name) {
        return "";
    }
    localStorage.setItem(STUDENT_NAME_STORAGE_KEY, name);
    return name;
}
