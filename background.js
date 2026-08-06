// Relays the browser-level keyboard command to the content script.
//
// This runs through chrome.commands rather than a keydown listener in the page
// for three reasons: the user can rebind it at chrome://extensions/shortcuts,
// pages that capture keystrokes (Docs, Gmail) can't swallow it, and it isn't
// affected by macOS rewriting the character when Option is held — which is why
// the old in-page Alt+Shift+F listener never fired on a Mac.
chrome.commands.onCommand.addListener(function (command) {
  if (command !== 'flip-language') return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: 'lang-fixer-flip' }, function () {
      void chrome.runtime.lastError;   // no content script here; nothing to do
    });
  });
});
