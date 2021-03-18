## Objective

This script is intened to be used together with the WindowListener API (WL API v1.44 or later).

The WL API provides a `notifyExperiment()` method, which allows to send data from your
WebExtension's background page to any privileged script running in any of your Experiments.
The recieving script must include `notifyTools.js` and register a listener.

It also allows to send data from any privileged script running in any of your Experiments
to your WebExtension background page and await a return value.

## Usage

This script provides the following public methods:

### registerListener(callback);

This registers a function in a privileged script to be called, when `messenger.WindowListener.notifyExperiment(data)` is
called from the WebExtension's background script. It returns an `id` which can be used to remove the listener again.

Example:

```
function doSomething(data) {
  console.log(data);
}
let id = notifyTools.registerListener(doSomething);
```

### removeListener(id)

Removes the listener with the given `id`.

Example:

```
notifyTools.removeListener(id);
```

### notifyBackground(data)

This function can be called from any privileged script in an Experiment to send data to the
WebExtension's background page. The function will return a Promise for whatever the listener
registered in the WebExtension's background script is returning.

Example:

```
notifyTools.notifyBackground({command: "doSomething"}).then((data) => {
  console.log(data);
});
```

The WebExtension background script needs to register a listener:

```
messenger.WindowListener.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "doSomething":
      //so something
      let rv = await doSomething();
      return rv;
      break;
  }
});
```

This allows to work on the add-on uprade in smaller steps, as single calls (like `window.openDialog()`)
in the middle of legacy code can be replaced by WebExtension calls, by stepping out of the Experiment
and back in when the task has been finished.
