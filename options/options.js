window.addEventListener("load", async () => {
  let tab = await messenger.tabs.getCurrent();
  await messenger.windows.create({type:"popup", url: "settings.html"});
  messenger.tabs.remove(tab.id)
})
