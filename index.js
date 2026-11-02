import { fillDefaults } from "./src/data-validation.js";
import { loadInterfaceFont } from "./src/fonts.js";
import { extension_settings } from "../../../extensions.js";
import { DEFAULT_SETTINGS, EXTENSION_NAME } from "./src/constants.js";
import { state, log, isPetActive, isDeviceEnabled } from "./src/state.js";
import { createUI, refreshHeroStatus } from "./src/ui.js";
import { createPetContainer, beginViewportResize, finishViewportResize } from "./src/pet-core.js";
import { initReactions } from "./src/pet-reactions.js";
import { initializeStorage, checkRemoteUpdates } from "./src/storage.js";
import { deactivatePet, pausePet, resumePet, watchUserActivity } from "./src/pet-lifecycle.js";

export { deactivatePet };

export function activatePet() {
    if (document.hidden || !state.settings?.enabled || !isDeviceEnabled() || state.storageBlocked || isPetActive()) return;
    if (state.settings.primaryPetEnabled === false && !(state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData)) return;
    state.runtimeActive = true;
    state.lifecycleEpoch++;
    if (state.settings.primaryPetEnabled !== false) createPetContainer("primary");
    if (state.settings.multiPet?.enabled && state.settings.multiPet?.secondPetData) createPetContainer("secondary");
    initReactions();
}

/** Phones only; tablets keep the PC layout. */
function detectMobile() {
    const ua = navigator.userAgent || "";
    // "Request desktop site" can make the UA look like a Mac or PC; a small touch screen is still a phone.
    const shortestScreenSide = Math.min(window.screen?.width || Infinity, window.screen?.height || Infinity);
    if (navigator.maxTouchPoints > 1 && shortestScreenSide <= 600) return true;

    const isTablet = /iPad/i.test(ua)
        || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)  // iPadOS 13+ reports "Macintosh"
        || (/Android/i.test(ua) && !/Mobile/i.test(ua));

    if (isTablet) return false;

    // By UA from here on: touch plus screen size would also match portrait tablets.
    return /Android.*Mobile|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

function handleDeviceChange() {
    const wasMobile = state.isMobile;
    state.isMobile = detectMobile();

    if (wasMobile === state.isMobile) return;

    log(`Device changed: ${wasMobile ? 'mobile' : 'PC'} -> ${state.isMobile ? 'mobile' : 'PC'}`);

    refreshHeroStatus();
    deactivatePet();
    if (state.settings?.enabled && isDeviceEnabled()) activatePet();
}

function setupMobileDetection() {
    let resizeDebounce = null;
    const onResize = () => {
        // Device type comes from the phone/desktop environment, not the size
        // of a resizable desktop window. No pet means no resize work at all.
        if (!isPetActive()) return;
        beginViewportResize();
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
            resizeDebounce = null;
            finishViewportResize();
        }, 250);
    };
    const onOrientationChange = () => {
        handleDeviceChange();
        onResize();
    };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onOrientationChange, { passive: true });
    // While the keyboard is open, a pet near the bottom must not cover the input.
    if (state.isMobile) {
        window.visualViewport?.addEventListener("resize", onResize, { passive: true });
        window.visualViewport?.addEventListener("scroll", onResize, { passive: true });
    }
}

jQuery(async () => {
    loadInterfaceFont();
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = structuredClone(DEFAULT_SETTINGS);
    }

    extension_settings[EXTENSION_NAME] = mergeSettings(extension_settings[EXTENSION_NAME], DEFAULT_SETTINGS);

    // v1 stored a single personalMemo string.
    const p = extension_settings[EXTENSION_NAME].personality;
    if (p?.personalMemo && typeof p.personalMemo === "string" && p.personalMemo.trim()) {
        if (!p.personalMemos || !Array.isArray(p.personalMemos)) p.personalMemos = [];
        p.personalMemos.push({ tag: "기타", content: p.personalMemo.trim() });
        delete p.personalMemo;
    } else if (p) {
        delete p.personalMemo;
    }

    await initializeStorage(extension_settings[EXTENSION_NAME]);

    state.isMobile = detectMobile();

    await createUI();

    setupMobileDetection();
    window.addEventListener("focus", checkRemoteUpdates);
    watchUserActivity();
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) pausePet();
        else if (isPetActive()) resumePet();
        else if (state.settings?.enabled && isDeviceEnabled()) activatePet();
    });

    if (state.settings.enabled && isDeviceEnabled()) {
        activatePet();
    } else {
        // Clear a pet element left by an older module in the same tab.
        deactivatePet();
    }

    log(`Extension loaded (${state.isMobile ? "mobile" : "PC"}, ${isDeviceEnabled() ? "visible" : "hidden"})`);
});

function mergeSettings(target, defaults) {
    if (target?.autoDiary && !target.autoDiary.customTimeThreshold) {
        if (target.autoDiary.minSessionMinutes === 30) target.autoDiary.minSessionMinutes = 5;
        target.autoDiary.customTimeThreshold = true;
    }
    return fillDefaults(target, defaults);
}
