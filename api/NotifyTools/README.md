# Objective

The NotifyTools provide a bidirectional messaging system between Experiments scripts and the WebExtension's background page (even with [e10s](https://developer.thunderbird.net/add-ons/updating/tb91/changes#thunderbird-is-now-multi-process-e-10-s) being enabled in Thunderbird Beta 86).

![messaging](https://user-images.githubusercontent.com/5830621/111921572-90db8d80-8a95-11eb-8673-4e1370d49e4b.png)

They allow to work on add-on uprades in smaller steps, as single calls (like `window.openDialog()`)
in the middle of legacy code can be replaced by WebExtension calls, by stepping out of the Experiment
and back in when the task has been finished.

More details can be found in [this update tutorial](https://github.com/thundernest/addon-developer-support/wiki/Tutorial:-Convert-add-on-parts-individually-by-using-a-messaging-system).

# Example

This repository includes the [NotifyToolsExample Add-On](https://github.com/thundernest/addon-developer-support/raw/master/auxiliary-apis/NotifyTools/notifyToolsExample.zip), showcasing how the NotifyTools can be used.

# Usage

Add the [NotifyTools API](https://github.com/thundernest/addon-developer-support/tree/master/auxiliary-apis/NotifyTools) to your add-on. Your `manifest.json` needs an entry like this:

```
  "experiment_apis": {
    "NotifyTools": {
      "schema": "api/NotifyTools/schema.json",
      "parent": {
        "scopes": ["addon_parent"],
        "paths": [["NotifyTools"]],
        "script": "api/NotifyTools/implementation.js",
        "events": ["startup"]
      }
    }
  },
```

Additionally to the [NotifyTools API](https://github.com/thundernest/addon-developer-support/tree/master/auxiliary-apis/NotifyTools) the [notifyTools.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/notifyTools) script is needed as the counterpart in Experiment scripts.

**Note:** You need to adjust the `notifyTools.js` script and add your add-on ID at the top.

## Receiving notifications from Experiment scripts

Add a listener for the `onNotifyBackground` event in your WebExtension's background page:

```
messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "doSomething":
      //do something
      let rv = await doSomething();
      return rv;
      break;
  }
});
```

The `onNotifyBackground` event will receive and respond to notifications send from your Experiment scripts:

```
notifyTools.notifyBackground({command: "doSomething"}).then((data) => {
  console.log(data);
});
```

Include the [notifyTools.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/notifyTools) script in your Experiment script to be able to use `notifyTools.notifyBackground()`. If you are injecting the script into a global Thunderbird window object, make sure to wrap it in your custom namespace, to prevent clashes with other add-ons.

**Note**: If multiple `onNotifyBackground` listeners are registered in the WebExtension's background page and more than one is returning data, the value
from the first one is returned to the Experiment. This may lead to inconsistent behavior, so make sure that for each
request only one listener is returning data.


## Sending notifications to Experiments scripts

Use the `notifyExperiment()` method to send a notification from the WebExtension's background page to Experiment scripts:

```
messenger.NotifyTools.notifyExperiment({command: "doSomething"}).then((data) => {
  console.log(data)
});
```

The receiving Experiment script needs to include the [notifyTools.js](https://github.com/thundernest/addon-developer-support/tree/master/scripts/notifyTools) script  and must setup a listener using the following methods:

### addListener(callback);

Adds a callback function, which is called when a notification from the WebExtension's background page has been received. The `addListener()` function returns an `id` which can be used to remove the listener again.

Example:

```
function doSomething(data) {
  console.log(data);
  return true;
}
let id = notifyTools.addListener(doSomething);
```

**Note**: NotifyTools currently is not 100% compatible with the behavior of
runtime.sendMessage. While runtime messaging is ignoring non-Promise return
values, NotifyTools only ignores `null`.

Why does this matter? Consider the following three listeners:
 
```
async function dominant_listener(data) {
 if (data.type == "A") {
   return { msg: "I should answer only type A" };
 }
}
 
function silent_listener(data) {
 if (data.type == "B") {
   return { msg: "I should answer only type B" };
 }
}

function selective_listener(data) {
 if (data.type == "C") {
   return Promise.resolve({ msg: "I should answer only type C" });
 }
}
```
 
When all 3 listeners are registered for the runtime.onMessage event,
the dominant listener will always respond, even for `data.type != "A"` requests,
because it is always returning a Promise (it is an async function). The return
value of the silent listener is ignored, and the selective listener returns a
value just for `data.type == "C"`. But since the dominant listener also returns
`null` for these requests, the actual return value depends on which listener is faster
and/or was registered first.
 
All notifyTools listener however ignore only `null` return values (so `null` can
actually never be returned). The above dominant listener will only respond to 
`type == "A"` requests, the silent listener will only respond to `type == "B"` 
requests and the selective listener will respond only to `type == "C"` requests.

### removeListener(id)

Removes the listener with the given `id`.

Example:

```
notifyTools.removeListener(id);
```

### removeAllListeners()

You must remove all added listeners when your add-on is disabled/reloaded. Instead of calling `removeListener()` for each added listener, you may call `removeAllListeners()`.

### setAddOnId(add-on-id)

The `notifyTools.js` script needs to know the ID of your add-on to be able to listen for messages. You may either define the ID directly in the first line of the script, or set it using `setAddOnId()`.