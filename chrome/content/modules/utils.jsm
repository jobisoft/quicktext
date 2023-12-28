"use strict";

var EXPORTED_SYMBOLS = ["quicktextUtils"]

var Services = globalThis.Services || ChromeUtils.import(
  "resource://gre/modules/Services.jsm"
).Services;

var quicktextUtils = {
  get dateTimeFormat() {
    if (Services.vc.compare(Services.appinfo.platformVersion, "59.0-1") >= 0) {
      return (format, timeStamp) => {
        let options = {};
        options["date-short"] = { dateStyle: "short" }; 
        options["date-long"] = { dateStyle: "long" }; 
        options["date-monthname"] = { month: "long" }; 
        options["date-year"] = { year: "numeric" }; 
        options["time-noseconds"] = { timeStyle: "short" }; 
        options["time-seconds"] = { timeStyle: "long" }; 
        return new Services.intl.DateTimeFormat(undefined, options[format.toLowerCase()]).format(timeStamp)
      }
    } else if (Services.vc.compare(Services.appinfo.platformVersion, "57.0-1") >= 0) {
      return (format, timeStamp) => {
        let options = {};
        options["date-short"] = { year: "numeric", month: "2-digit", day: "2-digit" }; 
        options["date-long"] = { weekday: "long", year: "numeric", month: "long", day: "2-digit" };
        options["date-monthname"] = { month: "long" };
        options["date-year"] = { year: "numeric" };
        options["time-noseconds"] = { hour: "2-digit", minute: "2-digit" }; 
        options["time-seconds"] = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
        return new Intl.DateTimeFormat(undefined, options[format.toLowerCase()]).format(timeStamp);
      }
    } else {
      return (format, timeStamp) => {
        let dateTimeService = Components.classes["@mozilla.org/intl/scriptabledateformat;1"].getService(Components.interfaces.nsIScriptableDateFormat);
        switch (format.toLowerCase()) {
          case "date-short":
            return dateTimeService.FormatDate("", dateTimeService.dateFormatShort, timeStamp.getFullYear(), timeStamp.getMonth()+1, timeStamp.getDate());
          case "date-long":
            return dateTimeService.FormatDate("", dateTimeService.dateFormatLong, timeStamp.getFullYear(), timeStamp.getMonth()+1, timeStamp.getDate())
          case "time-noseconds":
            return dateTimeService.FormatTime("", dateTimeService.timeFormatNoSeconds, timeStamp.getHours(), timeStamp.getMinutes(), timeStamp.getSeconds())
          case "time-seconds":
            return dateTimeService.FormatTime("", dateTimeService.timeFormatSeconds, timeStamp.getHours(), timeStamp.getMinutes(), timeStamp.getSeconds())
          case "date-monthname":
            return dateTimeService.FormatDate("", dateTimeService.dateFormatLong, timeStamp.getMonth()+1);
          case "date-year":
            return dateTimeService.FormatDate("", dateTimeService.dateFormatLong, timeStamp.getFullYear());
          
        }
      }
    }
  }
}
