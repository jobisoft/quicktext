## Objective

Use this API to access Thunderbird's system preferences or to migrate your own preferences from the Thunderbird preference system to the local storage of your MailExtension.

## Usage

This API provides the following methods:

### async getPref(aName, [aFallback])

Returns the value for the ``aName`` preference. If it is not defined or has no default value assigned, ``aFallback`` will be returned (which defaults to ``null``).

### async getUserPref(aName)

Returns the user defined value for the ``aName`` preference. This will ignore any defined default value and will only return an explicitly set value, which differs from the default. Otherwise it will return ``null``.

### clearUserPref(aName)

Clears the user defined value for preference ``aName``. Subsequent calls to ``getUserPref(aName)`` will return ``null``.

### async setPref(aName, aValue)

Set the ``aName`` preference to the given value. Will return false and log an error to the console, if the type of ``aValue`` does not match the type of the preference.

---

A detailed example using the LegacyPref API to migrate add-on preferences to the local storage can be found in [/scripts/preferences/](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences).
