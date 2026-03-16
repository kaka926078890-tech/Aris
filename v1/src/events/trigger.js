/**
 * Trigger logic: user-initiated (e.g. click center) and Aris proactive.
 * User trigger is handled in renderer (main.js: center click -> showDialogue).
 * Aris proactive is handled in main process (dialogue/proactive.js, interval in electron.main.js).
 * This module can later centralize trigger registration if needed.
 */
module.exports = {};
