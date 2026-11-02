let overlay = null, source = null, opener = null, openedValue = "";

function build() {
    document.body.insertAdjacentHTML("beforeend", `
    <div class="stvp-text-expand" hidden>
        <div class="stvp-text-expand-box" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="stvp-text-expand-title">
            <header><strong id="stvp-text-expand-title"></strong><button type="button" class="stvp-text-expand-close" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button></header>
            <textarea class="stvp-text-expand-input" spellcheck="false"></textarea>
            <footer><small class="stvp-text-expand-count"></small><button type="button" class="stvp-text-expand-done">완료</button></footer>
        </div>
    </div>`);
    overlay = document.body.lastElementChild;
    const input = overlay.querySelector("textarea"), count = overlay.querySelector(".stvp-text-expand-count");
    const updateCount = () => { count.textContent = `${Array.from(input.value).length.toLocaleString()}자 · 자동 저장`; };
    input.addEventListener("input", () => {
        updateCount();
        if (!source) return;
        source.value = input.value;
        source.dispatchEvent(new Event("input", { bubbles: true }));
    });
    overlay.addEventListener("click", event => {
        if (event.target === overlay || event.target.closest(".stvp-text-expand-close, .stvp-text-expand-done")) close();
    });
    overlay.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); close(); }
    });
    overlay._updateCount = updateCount;
}

function open(field, title) {
    if (!overlay) build();
    source = field; opener = document.activeElement; openedValue = field.value;
    overlay.querySelector("#stvp-text-expand-title").textContent = title || "크게 보기";
    const input = overlay.querySelector("textarea");
    input.value = field.value; input.placeholder = field.placeholder;
    overlay._updateCount();
    overlay.hidden = false;
    // Touch screens: don't raise the keyboard until the user taps the text.
    if (matchMedia("(pointer: coarse)").matches) overlay.querySelector(".stvp-text-expand-box").focus({ preventScroll: true });
    else {
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (source && source.value !== openedValue) source.dispatchEvent(new Event("change", { bubbles: true }));
    source = null;
    opener?.focus?.({ preventScroll: true }); opener = null;
}

export function bindTextExpand(root) {
    root.addEventListener("click", event => {
        const button = event.target.closest("[data-expand]");
        const field = button && document.getElementById(button.dataset.expand);
        if (field) open(field, button.dataset.expandTitle);
    });
}
