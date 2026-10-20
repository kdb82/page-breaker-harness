chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    // The isolated world keeps this game's state in the tab. Reinjection toggles it.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (error) {
    // Chrome does not allow injection into its own pages or the Web Store.
    console.warn("Page Siege could not start on this tab:", error);
  }
});
