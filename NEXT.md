[x] load content of template and script files from background via Experiment
[x] parse templates and script files from background
[x] swap in compose script code and make it use files loaded from background
[x] make settings window update/reparse templates 
[x] eliminate template setter
[x] replace and properly implement file picker
[x] replace most of utils.mjs and email-addresses.mjs with messengerUtilities API
[x] implement choice via popover
[x] migrate templates to local storage (keep XML files as backup) and decouple XUL
    settings dialog from Experiment usage as much as possible
[x] properly implement startup imports
[x] rename group to groups everywhere
[x] find a preliminary solution for scripts, looks like this will not work without breaking
    existing scripts :-( (they have to use WebExtension code)
[x] replace popover by popup, composer gets into an invalid state and many other issues

[x] change composer toolbar Experiment to use templates from storage
[x] change composer toolbar Experiment to use notifytools to trigger actions
[x] implement toolbar reload on template change and time change
[x] replace compose action button by menu typed action button
[x] remove as much legacy Quicktext code as possible 
[x] move composer toolbar Experiment into a separate add-on

[x] make template manager use files loaded from background
[x] replace XUL template manager with HTML template manager
[x] keyword + special seems to eat the leading space

[ ] add gallery for attachments, images and text files, which are currently
    references via file system paths, which will not work as a pure webextension
    We might use the leftover locale `quicktext.browse.label` ("Browse").

[ ] URL prompt for ATTACHMENT=URL and IMAGE=URL variables is currently shown via
    executeScript/window.prompt() bound to the compose tab. Revisit once the
    Thunderbird team introduces popover support for the entire compose window —
    a custom WebExtension popup would then be the cleaner solution.

[ ] use script UUIDs