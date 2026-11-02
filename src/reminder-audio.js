let context;
let armed = false;
/** Audio is unlocked by a real user gesture, without a permission prompt or media download. */
export function armReminderAudio(enabled) {
    if (armed) return;
    armed = true;
    const unlock = event => {
        if (!event.isTrusted || !enabled()) return;
        try {
            const Audio = window.AudioContext || window.webkitAudioContext;
            if (!Audio) return;
            context ||= new Audio();
            if (context.state === 'suspended') context.resume().catch(() => {});
        } catch { /* Audio support must never prevent a reminder. */ }
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
}
export function playReminderSound(enabled) {
    if (!enabled || context?.state !== 'running') return false;
    try {
        const start = context.currentTime;
        for (const [offset, frequency] of [[0, 660], [.16, 880]]) {
            const tone = context.createOscillator(), gain = context.createGain();
            tone.type = 'sine'; tone.frequency.value = frequency;
            gain.gain.setValueAtTime(0, start + offset);
            gain.gain.linearRampToValueAtTime(.055, start + offset + .02);
            gain.gain.exponentialRampToValueAtTime(.001, start + offset + .25);
            tone.connect(gain); gain.connect(context.destination);
            tone.onended = () => { tone.disconnect(); gain.disconnect(); };
            tone.start(start + offset); tone.stop(start + offset + .27);
        }
        return true;
    } catch { return false; }
}
