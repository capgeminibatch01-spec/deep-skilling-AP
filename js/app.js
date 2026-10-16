/* =====================================================================
   Global behaviour shared by the public site.

   Ctrl + Shift + M opens the admin login page (§5). It is deliberately
   undocumented in the UI, works from any focused field, and never
   submits the form.
   ===================================================================== */
(function () {
  "use strict";

  document.addEventListener(
    "keydown",
    function (event) {
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;

      // event.code is layout-independent; event.key covers remapped keyboards.
      const isM = event.code === "KeyM" || (event.key && event.key.toLowerCase() === "m");
      if (!isM) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.href = "admin.html";
    },
    true, // capture phase: fires even while a field has focus
  );

  // Guard against an accidental Enter-key submit from a single-line input.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    const el = event.target;
    if (el && el.tagName === "INPUT" && el.type !== "submit" && el.form) {
      event.preventDefault();
    }
  });
})();
