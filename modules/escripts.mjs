/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

async function register(id, name, scripts) {
  const externalScripts = await browser.storage.session
    .get({ externalScripts: [] })
    .then(rv => rv.externalScripts.filter(e => e.id != id));
  externalScripts.push({ id, name, scripts });
  await browser.storage.session.set({ externalScripts });
}

async function unregister(id) {
  const externalScripts = await browser.storage.session
    .get({ externalScripts: [] })
    .then(rv => rv.externalScripts.filter(e => e.id != id));
  await browser.storage.session.set({ externalScripts });
}

async function unregisterIfKnown(id) {
  const { externalScripts = [] } = await browser.storage.session.get({ externalScripts: [] });
  if (externalScripts.some(e => e.id === id)) {
    await unregister(id);
  }
}

export async function init() {
  browser.runtime.onMessageExternal.addListener(({ register_script_addon, available_scripts }, { id }) => {
    if (register_script_addon && available_scripts) {
      // If available_scripts is an array, it is the old list-of-names format.
      // Convert it to the new format with extended information.
      const scripts = Array.isArray(available_scripts)
        ? Object.fromEntries(available_scripts.map(name => [name, { usage: name, description: "" }]))
        : available_scripts;

      if (Object.keys(scripts).length > 0) {
        return register(id, register_script_addon, scripts);
      }
    }
    return false;
  });

  browser.management.onDisabled.addListener(addon => unregisterIfKnown(addon.id));
  browser.management.onUninstalled.addListener(addon => unregisterIfKnown(addon.id));
}
