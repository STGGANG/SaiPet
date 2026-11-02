import { saveImageFile, saveSettings } from "./storage.js";
import { FURNITURE_REACTIONS, roomSnapshot } from "./house-data.js";
import { HOUSE_THEMES, themeRoomSnapshot } from "./house-themes.js";

/** Bind the optional library drawers. The caller owns the scene and its timers. */
export function setupHouseLibrary({ popup, getHouse, refreshCatalog, applyLayout }) {
    let active = true, previous = null, uploadBusy = false;
    const $ = selector => popup.querySelector(selector);
    const status = text => { $("#stvp-house-library-status").textContent = text; };
    const id = () => globalThis.crypto?.randomUUID?.() || "room-" + Date.now() + "-" + Math.random();
    const selected = () => {
        const value = $("#stvp-house-layout-select").value;
        if (value.startsWith("builtin:")) {
            const themeId = value.slice(8), theme = Object.hasOwn(HOUSE_THEMES, themeId) ? HOUSE_THEMES[themeId] : null;
            return theme ? { id: value, name: theme.label, builtin: true, snapshot: themeRoomSnapshot(themeId, getHouse()) } : null;
        }
        return getHouse().layouts.find(layout => layout?.id === value);
    };

    function refreshLayouts(selectedId = $("#stvp-house-layout-select").value) {
        const select = $("#stvp-house-layout-select"); select.replaceChildren(new Option("방 배치 선택", ""));
        const builtins = document.createElement("optgroup"); builtins.label = "꾸며진 기본 테마";
        for (const [themeId, theme] of Object.entries(HOUSE_THEMES)) builtins.append(new Option(theme.label, "builtin:" + themeId));
        select.append(builtins);
        for (const layout of getHouse().layouts) if (layout?.id && layout?.snapshot) select.add(new Option(layout.name || "이름 없는 방", layout.id));
        select.value = selectedId;
        const layout = selected();
        $("#stvp-house-layout-load").disabled = !layout;
        for (const name of ["overwrite", "delete"]) $("#stvp-house-layout-" + name).disabled = !layout || !!layout.builtin;
    }
    function refreshCustom() {
        const list = $("#stvp-house-custom-list"); list.replaceChildren();
        for (const asset of getHouse().customFurniture) {
            if (!asset?.id || !asset.image) continue;
            const row = document.createElement("div"), image = document.createElement("img");
            row.className = "stvp-house-library-row"; image.src = asset.image; image.alt = ""; image.loading = "lazy";
            const name = document.createElement("span"); name.textContent = asset.label || "내 가구";
            const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
            remove.title = "보관함에서 제거 (배치한 가구는 유지)"; remove.setAttribute("aria-label", (asset.label || "내 가구") + " 보관함에서 제거");
            remove.addEventListener("click", () => {
                getHouse().customFurniture = getHouse().customFurniture.filter(value => value !== asset);
                saveSettings(); refreshCustom(); refreshCatalog();
                status("보관함에서 제거했습니다. 방과 저장한 배치에 있는 가구는 유지됩니다.");
            });
            row.append(image, name, remove); list.append(row);
        }
    }
    for (const [value, info] of Object.entries(FURNITURE_REACTIONS)) $("#stvp-house-custom-reaction").add(new Option(info.label, value));
    $("#stvp-house-custom-reaction").value = "admire";
    $("#stvp-house-custom-file").addEventListener("change", async event => {
        const input = event.target, file = input.files[0]; if (!file || uploadBusy) return;
        const room = getHouse();
        if (room.customFurniture.length >= 60) { input.value = ""; status("내 가구는 최대 60개까지 등록할 수 있습니다."); return; }
        const label = ($("#stvp-house-custom-name").value.trim() || file.name.replace(/\.[^.]+$/, "") || "내 가구").slice(0, 60);
        const reaction = $("#stvp-house-custom-reaction").value;
        uploadBusy = true; input.disabled = true; status("이미지를 저장하는 중입니다…");
        try {
            if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("PNG, JPG, WebP 이미지를 선택해 주십시오.");
            const image = await saveImageFile(file, 1024, .92);
            if (!active || getHouse() !== room) return;
            room.customFurniture.push({ id: id(), label, image, reaction });
            saveSettings(); refreshCatalog(); refreshCustom();
            status("등록했습니다. 꾸미기 중에 가구 그림을 누르면 방에 놓을 수 있습니다.");
        } catch (error) { if (active) status("이미지 등록 실패: " + error.message); }
        finally { uploadBusy = false; input.disabled = false; input.value = ""; }
    });
    $("#stvp-house-layout-select").addEventListener("change", () => {
        const layout = selected(); if (layout) $("#stvp-house-layout-name").value = layout.name;
        refreshLayouts();
    });
    $("#stvp-house-layout-save").addEventListener("click", () => {
        if (getHouse().layouts.length >= 30) { status("방 배치는 최대 30개까지 저장할 수 있습니다."); return; }
        const layout = { id: id(), name: ($("#stvp-house-layout-name").value.trim() || "내 방 " + (getHouse().layouts.length + 1)).slice(0,60), snapshot: roomSnapshot(getHouse()) };
        getHouse().layouts.push(layout); saveSettings(); refreshLayouts(layout.id); status("새 방 배치를 저장했습니다.");
    });
    $("#stvp-house-layout-overwrite").addEventListener("click", () => {
        const layout = selected(); if (!layout || layout.builtin) return;
        layout.snapshot = roomSnapshot(getHouse());
        layout.name = ($("#stvp-house-layout-name").value.trim() || layout.name).slice(0,60);
        saveSettings(); refreshLayouts(layout.id); status("선택한 방 배치를 갱신했습니다.");
    });
    $("#stvp-house-layout-load").addEventListener("click", () => {
        const layout = selected(); if (!layout) return;
        const before = roomSnapshot(getHouse());
        try { applyLayout(layout.snapshot); previous = before; $("#stvp-house-layout-undo").hidden = false; status(layout.builtin ? "기본 테마를 불러왔습니다. 가구를 자유롭게 바꾸고 내 방으로 새로 저장할 수 있습니다." : "방 배치를 불러왔습니다."); }
        catch (error) { status(error.message); }
    });
    $("#stvp-house-layout-undo").addEventListener("click", () => {
        if (!previous) return;
        applyLayout(previous); previous = null; $("#stvp-house-layout-undo").hidden = true; status("불러오기 전 배치로 돌아갔습니다.");
    });
    $("#stvp-house-layout-delete").addEventListener("click", () => {
        const layout = selected(); if (!layout || layout.builtin || !confirm("선택한 방 배치를 삭제하시겠습니까? 현재 방은 그대로 유지됩니다.")) return;
        getHouse().layouts = getHouse().layouts.filter(value => value !== layout);
        saveSettings(); refreshLayouts(""); status("저장한 방 배치를 삭제했습니다.");
    });
    refreshCustom(); refreshLayouts();
    return () => { active = false; };
}
