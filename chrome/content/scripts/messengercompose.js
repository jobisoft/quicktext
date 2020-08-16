// Import any needed modules.
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

// Load an additional JavaScript file.
Services.scriptloader.loadSubScript("chrome://quicktext/content/quicktext.js", window, "UTF-8");

function onLoad(activatedWhileWindowOpen) {
  
  WL.injectCSS("resource://quicktext/skin/quicktext.css");
  WL.injectElements(`
<commandset id="composeCommands">
    <commandset id="quicktextCommands">
      <command id="cmd_quicktextKey1" disabled="true" />
      <command id="cmd_quicktextKey2" disabled="true" />
      <command id="cmd_quicktextKey3" disabled="true" />
      <command id="cmd_quicktextKey4" disabled="true" />
      <command id="cmd_quicktextKey5" disabled="true" />
      <command id="cmd_quicktextKey6" disabled="true" />
      <command id="cmd_quicktextKey7" disabled="true" />
      <command id="cmd_quicktextKey8" disabled="true" />
      <command id="cmd_quicktextKey9" disabled="true" />
      <command id="cmd_quicktextKey10" disabled="true" />
    </commandset>
  </commandset>

  <toolbarpalette id="MsgComposeToolbarPalette">
    <toolbarbutton class="toolbarbutton-1" type="menu"
                   id="button-quicktext" label="&quicktext.shortname.label;"
                   orient="horizontal">
      <menupopup />
    </toolbarbutton>
  </toolbarpalette>

	<popup id="msgComposeContext">
		<menuseparator id="quicktext-popupsep" hidden="true" insertafter="spellCheckSuggestionsSeparator"/>
		<menu id="quicktext-popup" label="&quicktext.label;" hidden="true" insertafter="spellCheckSuggestionsSeparator"  class="menu-iconic quicktext-icon menuitem-iconic" >
		  <menupopup />
		</menu>
	</popup>

  <menupopup id="menu_View_Popup">
    <menuitem id="quicktext-view" type="checkbox" label="&quicktext.label;" oncommand="quicktext.toogleToolbar();"/>
  </menupopup>

  <menupopup id="taskPopup">
    <menuitem id="quicktext-settings" label="&quicktext.label;" oncommand="quicktext.openSettings();" insertafter="tasksMenuAddressBook" class="menu-iconic quicktext-icon menuitem-iconic" />
    <menuseparator insertafter="tasksMenuAddressBook" />
  </menupopup>

  <toolbox id="headers-box">
    <toolbar id="quicktext-toolbar">
      <toolbarbutton type="menu" id="quicktext-variables" label="&quicktext.variables.label;">
        <menupopup>
          <menu label="&quicktext.to.label;">
            <menupopup>
              <menuitem label="&quicktext.firstname.label;" oncommand="quicktext.insertVariable('TO=firstname');" />
              <menuitem label="&quicktext.lastname.label;" oncommand="quicktext.insertVariable('TO=lastname');" />
              <menuitem label="&quicktext.fullname.label;" oncommand="quicktext.insertVariable('TO=fullname');" />
              <menuitem label="&quicktext.displayname.label;" oncommand="quicktext.insertVariable('TO=displayname');" />
              <menuitem label="&quicktext.nickname.label;" oncommand="quicktext.insertVariable('TO=nickname');" />
              <menuitem label="&quicktext.email.label;" oncommand="quicktext.insertVariable('TO=email');" />
              <menuitem label="&quicktext.worknumber.label;" oncommand="quicktext.insertVariable('TO=workphone');" />
              <menuitem label="&quicktext.faxnumber.label;" oncommand="quicktext.insertVariable('TO=faxnumber');" />
              <menuitem label="&quicktext.cellularnumber.label;" oncommand="quicktext.insertVariable('TO=cellularnumber');" />
              <menuitem label="&quicktext.jobtitle.label;" oncommand="quicktext.insertVariable('TO=jobtitle');" />
              <menuitem label="&quicktext.custom1.label;" oncommand="quicktext.insertVariable('TO=custom1');" />
              <menuitem label="&quicktext.custom2.label;" oncommand="quicktext.insertVariable('TO=custom2');" />
              <menuitem label="&quicktext.custom3.label;" oncommand="quicktext.insertVariable('TO=custom3');" />
              <menuitem label="&quicktext.custom4.label;" oncommand="quicktext.insertVariable('TO=custom4');" />
            </menupopup>
          </menu>
          <menu label="&quicktext.from.label;">
            <menupopup>
              <menuitem label="&quicktext.firstname.label;" oncommand="quicktext.insertVariable('FROM=firstname');" />
              <menuitem label="&quicktext.lastname.label;" oncommand="quicktext.insertVariable('FROM=lastname');" />
              <menuitem label="&quicktext.fullname.label;" oncommand="quicktext.insertVariable('FROM=fullname');" />
              <menuitem label="&quicktext.displayname.label;" oncommand="quicktext.insertVariable('FROM=displayname');" />
              <menuitem label="&quicktext.nickname.label;" oncommand="quicktext.insertVariable('FROM=nickname');" />
              <menuitem label="&quicktext.email.label;" oncommand="quicktext.insertVariable('FROM=email');" />
              <menuitem label="&quicktext.worknumber.label;" oncommand="quicktext.insertVariable('FROM=workphone');" />
              <menuitem label="&quicktext.faxnumber.label;" oncommand="quicktext.insertVariable('FROM=faxnumber');" />
              <menuitem label="&quicktext.cellularnumber.label;" oncommand="quicktext.insertVariable('FROM=cellularnumber');" />
              <menuitem label="&quicktext.jobtitle.label;" oncommand="quicktext.insertVariable('FROM=jobtitle');" />
              <menuitem label="&quicktext.custom1.label;" oncommand="quicktext.insertVariable('FROM=custom1');" />
              <menuitem label="&quicktext.custom2.label;" oncommand="quicktext.insertVariable('FROM=custom2');" />
              <menuitem label="&quicktext.custom3.label;" oncommand="quicktext.insertVariable('FROM=custom3');" />
              <menuitem label="&quicktext.custom4.label;" oncommand="quicktext.insertVariable('FROM=custom4');" />
            </menupopup>
          </menu>
          <menu label="&quicktext.attachments.label;">
            <menupopup>
              <menuitem label="&quicktext.filename.label;" oncommand="quicktext.insertVariable('ATT=name');" />
              <menuitem label="&quicktext.filenameAndSize.label;" oncommand="quicktext.insertVariable('ATT=full');" />
            </menupopup>
          </menu>
          <menu label="&quicktext.dateTime.label;">
            <menupopup>
              <menuitem id="date-short" oncommand="quicktext.insertVariable('DATE');" />
              <menuitem id="date-long" oncommand="quicktext.insertVariable('DATE=long');" />
              <menuitem id="date-monthname" oncommand="quicktext.insertVariable('DATE=monthname');" />
              <menuitem id="time-noseconds" oncommand="quicktext.insertVariable('TIME');" />
              <menuitem id="time-seconds" oncommand="quicktext.insertVariable('TIME=seconds');" />
            </menupopup>
          </menu>
          <menu label="&quicktext.other.label;">
            <menupopup>
              <menuitem label="&quicktext.clipboard.label;" oncommand="quicktext.insertVariable('CLIPBOARD');" />
              <menuitem label="&quicktext.counter.label;" oncommand="quicktext.insertVariable('COUNTER');" />
              <menuitem label="&quicktext.subject.label;" oncommand="quicktext.insertVariable('SUBJECT');" />
              <menuitem label="&quicktext.version.label;" oncommand="quicktext.insertVariable('VERSION');" />
            </menupopup>
          </menu>
        </menupopup>
      </toolbarbutton>
      <toolbarbutton type="menu" id="quicktext-other" label="&quicktext.other.label;">
        <menupopup>
          <menuitem label="&quicktext.insertTextFromFileAsText.label;" oncommand="quicktext.insertContentFromFile(0);" />
          <menuitem label="&quicktext.insertTextFromFileAsHTML.label;" oncommand="quicktext.insertContentFromFile(1);" />
        </menupopup>
      </toolbarbutton>
    </toolbar>
  </toolbox>`,
  ["chrome://quicktext/locale/quicktext.dtd"]);
  
  window.quicktext.load();
  //addEventListener("compose-window-reopen", function() { quicktext.reload(); }, true);
  //addEventListener("compose-window-init", function() { quicktext.windowInit(); }, true);
}

function onUnload(deactivatedWhileWindowOpen) {
  window.quicktext.unload();
  delete window.quicktext;
}
