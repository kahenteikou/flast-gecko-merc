/* Any copyright is dedicated to the public domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

// Bug 787517: Remove iframe in the handler of showmodalprompt. This shouldn't
// cause an exception to be thrown.

"use strict";

SimpleTest.waitForExplicitFinish();

function runTest() {
  browserElementTestHelpers.setEnabledPref(true);
  browserElementTestHelpers.addPermission();

  var iframe = document.createElement('iframe');
  SpecialPowers.wrap(iframe).mozbrowser = true;
  document.body.appendChild(iframe);

  iframe.addEventListener("mozbrowsershowmodalprompt", function(e) {
    document.body.removeChild(iframe);
    SimpleTest.executeSoon(function() {
      ok(true);
      SimpleTest.finish();
    });
  });

  iframe.src = "data:text/html,<html><body><script>alert(\"test\")</script>" +
               "</body></html>";
}

runTest();

