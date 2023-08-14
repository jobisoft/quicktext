window.addEventListener("load", async () => {
  let tab = await browser.tabs.getCurrent();
  await browser.Quicktext.openSettings(tab.windowId);
  browser.tabs.remove(tab.id)
})
